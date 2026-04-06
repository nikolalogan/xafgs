import { ensureNodeConfig } from './node-config'
import { BlockEnum, type DifyEdge, type DifyNode, type WorkflowParameter } from './types'
import { buildIfElseBranchHandleId, IF_ELSE_FALLBACK_HANDLE } from '@/lib/workflow-ifelse'
import { extractSchemaLeafPaths, validateParameterJsonDefault } from './json-schema'

export type WorkflowIssue = {
  id: string
  nodeId?: string
  level: 'error' | 'warning'
  title: string
  message: string
}

const trim = (value: string) => value.trim()

const hasDuplicate = (values: string[]) => {
  const normalized = values.map(trim).filter(Boolean)
  return normalized.length !== new Set(normalized).size
}

const extractWritebackTargets = (node: DifyNode) => {
  const config = node.data.config
  if (!config || typeof config !== 'object')
    return []
  const raw = (config as { writebackMappings?: unknown }).writebackMappings
  if (!Array.isArray(raw))
    return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object')
        return ''
      const targetPath = (item as { targetPath?: unknown }).targetPath
      return typeof targetPath === 'string' ? trim(targetPath) : ''
    })
    .filter(Boolean)
}

const findParallelWritebackConflicts = (targetNodes: DifyNode[]) => {
  const pathOwners = new Map<string, Set<string>>()
  targetNodes.forEach((node) => {
    extractWritebackTargets(node).forEach((path) => {
      if (!pathOwners.has(path))
        pathOwners.set(path, new Set<string>())
      pathOwners.get(path)!.add(node.id)
    })
  })
  return [...pathOwners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([path]) => path)
    .sort()
}

const countArrayToken = (value: string) => (value.match(/\[\]/g) || []).length

const validateArrayWritebackMappings = (
  prefix: string,
  nodeId: string,
  nodeTitle: string,
  mappings: Array<{ sourcePath: string; targetPath: string }>,
): WorkflowIssue[] => {
  const issues: WorkflowIssue[] = []
  mappings.forEach((item, index) => {
    const sourcePath = trim(item.sourcePath || '')
    const targetPath = trim(item.targetPath || '')
    if (!sourcePath || !targetPath)
      return
    const sourceCount = countArrayToken(sourcePath)
    const targetCount = countArrayToken(targetPath)

    if (sourceCount > 1 || targetCount > 1) {
      issues.push({
        id: `${prefix}-writeback-array-nested-${index}`,
        nodeId,
        level: 'error',
        title: `${nodeTitle} 数组映射层级不支持`,
        message: 'writeback 映射暂不支持多层 []，请拆分为单层数组映射。',
      })
      return
    }

    if (targetCount === 1 && sourceCount === 0) {
      issues.push({
        id: `${prefix}-writeback-array-source-missing-${index}`,
        nodeId,
        level: 'warning',
        title: `${nodeTitle} 数组映射来源可能不正确`,
        message: 'targetPath 使用了 [] 但 sourcePath 未使用 []，该映射不会逐项索引对应。',
      })
    }
  })
  return issues
}

export const validateWorkflow = (
  nodes: DifyNode[],
  edges: DifyEdge[],
  workflowParameters: WorkflowParameter[] = [],
): WorkflowIssue[] => {
  const issues: WorkflowIssue[] = []
  const nodeIdSet = new Set(nodes.map(node => node.id))

  const workflowParamNames = workflowParameters.map(item => item.name)
  if (workflowParameters.some(item => !trim(item.name) || !trim(item.label))) {
    issues.push({
      id: 'workflow-params-invalid',
      level: 'error',
      title: '流程参数不完整',
      message: '流程参数名称和显示名不能为空。',
    })
  }
  if (hasDuplicate(workflowParamNames)) {
    issues.push({
      id: 'workflow-params-dup',
      level: 'error',
      title: '流程参数重复',
      message: '流程参数名称不能重复。',
    })
  }
  workflowParameters.forEach((item, index) => {
    const valueType = item.valueType
    if (valueType !== 'array' && valueType !== 'object')
      return
    const check = validateParameterJsonDefault(valueType, item.defaultValue, item.json)
    if (!check.valid) {
      issues.push({
        id: `workflow-params-json-${index}`,
        level: 'error',
        title: `流程参数 ${item.name || item.label || index + 1} JSON 配置非法`,
        message: check.error,
      })
    }
  })

  const startNodes = nodes.filter(node => node.data.type === BlockEnum.Start)
  const endNodes = nodes.filter(node => node.data.type === BlockEnum.End)
  if (startNodes.length === 0) {
    issues.push({
      id: 'global-start-required',
      level: 'error',
      title: '缺少开始节点',
      message: '工作流必须包含一个开始节点。',
    })
  }
  if (startNodes.length > 1) {
    issues.push({
      id: 'global-start-singleton',
      level: 'error',
      title: '开始节点过多',
      message: '工作流只能存在一个开始节点。',
    })
  }
  if (endNodes.length === 0) {
    issues.push({
      id: 'global-end-required',
      level: 'error',
      title: '缺少结束节点',
      message: '工作流至少需要一个结束节点。',
    })
  }

  edges.forEach((edge) => {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) {
      issues.push({
        id: `edge-${edge.id}-invalid`,
        level: 'error',
        title: '连线无效',
        message: `连线 ${edge.id} 指向了不存在的节点。`,
      })
    }
  })

  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  const outgoingBySource = new Map<string, DifyEdge[]>()
  nodes.forEach((node) => {
    inDegree.set(node.id, 0)
    outDegree.set(node.id, 0)
    outgoingBySource.set(node.id, [])
  })
  edges.forEach((edge) => {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1)
    const list = outgoingBySource.get(edge.source)
    if (list)
      list.push(edge)
  })

  nodes.forEach((node) => {
    const inCount = inDegree.get(node.id) ?? 0
    const outCount = outDegree.get(node.id) ?? 0
    const prefix = `node-${node.id}`
    const nodeOutgoing = outgoingBySource.get(node.id) ?? []

    if (node.data.type === BlockEnum.Start && outCount === 0) {
      issues.push({
        id: `${prefix}-start-no-output`,
        nodeId: node.id,
        level: 'error',
        title: `${node.data.title} 未连接`,
        message: '开始节点至少需要一条输出连线。',
      })
    }

    if (node.data.type === BlockEnum.End && inCount === 0) {
      issues.push({
        id: `${prefix}-end-no-input`,
        nodeId: node.id,
        level: 'error',
        title: `${node.data.title} 未连接`,
        message: '结束节点至少需要一条输入连线。',
      })
    }
    if (node.data.type !== BlockEnum.Start && inCount > 1) {
      const rawConfig = node.data.config
      const hasExplicitJoinMode = !!rawConfig
        && typeof rawConfig === 'object'
        && typeof (rawConfig as { joinMode?: unknown }).joinMode === 'string'
      if (!hasExplicitJoinMode) {
        issues.push({
          id: `${prefix}-join-mode-default`,
          nodeId: node.id,
          level: 'warning',
          title: `${node.data.title} 多入边汇聚策略未显式配置`,
          message: '当前节点存在多条输入连线，建议显式设置 joinMode（all/any）以避免执行歧义。',
        })
      }
    }

    if (node.data.type !== BlockEnum.Start && node.data.type !== BlockEnum.End) {
      if (inCount === 0) {
        issues.push({
          id: `${prefix}-no-input`,
          nodeId: node.id,
          level: 'warning',
          title: `${node.data.title} 未接入`,
          message: '该节点没有输入连线，可能不会被执行。',
        })
      }
      if (outCount === 0) {
        issues.push({
          id: `${prefix}-no-output`,
          nodeId: node.id,
          level: 'warning',
          title: `${node.data.title} 未输出`,
          message: '该节点没有输出连线，流程可能在此中断。',
        })
      }
    }

    if (node.data.type !== BlockEnum.End) {
      const rawConfig = node.data.config
      const hasExplicitFanOutMode = !!rawConfig
        && typeof rawConfig === 'object'
        && typeof (rawConfig as { fanOutMode?: unknown }).fanOutMode === 'string'
      const fanOutMode = hasExplicitFanOutMode && (rawConfig as { fanOutMode?: unknown }).fanOutMode === 'parallel'
        ? 'parallel'
        : 'sequential'
      const groupedOutgoing = new Map<string, DifyEdge[]>()
      nodeOutgoing.forEach((edge) => {
        const key = trim(edge.sourceHandle || '__default__')
        if (!groupedOutgoing.has(key))
          groupedOutgoing.set(key, [])
        groupedOutgoing.get(key)!.push(edge)
      })

      if (fanOutMode === 'parallel') {
        const groupsToCheck = node.data.type === BlockEnum.IfElse
          ? [...groupedOutgoing.values()].filter(group => group.length > 1)
          : (outCount > 1 ? [nodeOutgoing] : [])
        groupsToCheck.forEach((group, groupIndex) => {
          const targetNodes = group
            .map(edge => nodes.find(item => item.id === edge.target))
            .filter((item): item is DifyNode => !!item)
          const conflictPaths = findParallelWritebackConflicts(targetNodes)
          if (conflictPaths.length === 0)
            return
          const preview = conflictPaths.slice(0, 3).join('，')
          const suffix = conflictPaths.length > 3 ? ` 等 ${conflictPaths.length} 项` : ''
          issues.push({
            id: `${prefix}-parallel-writeback-conflict-${groupIndex}`,
            nodeId: node.id,
            level: 'warning',
            title: `${node.data.title} 并行写入可能互相影响`,
            message: `并行后续节点存在相同写入路径：${preview}${suffix}。建议改为顺序执行或拆分目标路径。`,
          })
        })
      }
    }

    if (node.data.type === BlockEnum.Start) {
      const config = ensureNodeConfig(BlockEnum.Start, node.data.config)
      const names = config.variables.map(item => item.name)
      if (config.variables.length === 0) {
        issues.push({
          id: `${prefix}-start-vars-empty`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 参数缺失`,
          message: '开始节点至少需要一个输入参数。',
        })
      }
      if (config.variables.some(item => !trim(item.name) || !trim(item.label))) {
        issues.push({
          id: `${prefix}-start-vars-invalid`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 参数不完整`,
          message: '开始节点参数的名称和展示名不能为空。',
        })
      }
      if (hasDuplicate(names)) {
        issues.push({
          id: `${prefix}-start-vars-dup`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 参数重复`,
          message: '开始节点参数名不能重复。',
        })
      }
      if (config.variables.some(item => item.type === 'select' && (item.options ?? []).length === 0)) {
        issues.push({
          id: `${prefix}-start-select-empty`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 下拉选项缺失`,
          message: '开始节点下拉参数至少需要一个选项。',
        })
      }
      if (config.variables.some(item => item.type === 'select' && (item.options ?? []).some(option => !trim(option.label) || !trim(option.value)))) {
        issues.push({
          id: `${prefix}-start-select-invalid`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 下拉选项不完整`,
          message: '开始节点下拉参数的名称和编码不能为空。',
        })
      }
      if (config.variables.some((item) => {
        if (item.type !== 'select')
          return false
        const codes = (item.options ?? []).map(option => option.value)
        return hasDuplicate(codes)
      })) {
        issues.push({
          id: `${prefix}-start-select-code-dup`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 下拉编码重复`,
          message: '开始节点下拉参数编码不能重复。',
        })
      }
    }

    if (node.data.type === BlockEnum.Input) {
      const config = ensureNodeConfig(BlockEnum.Input, node.data.config)
      const names = config.fields.map(item => item.name)
      if (config.fields.length === 0) {
        issues.push({
          id: `${prefix}-input-empty`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 字段缺失`,
          message: '输入节点至少需要一个字段。',
        })
      }
      if (config.fields.some(field => !trim(field.name) || !trim(field.label))) {
        issues.push({
          id: `${prefix}-input-invalid`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 字段不完整`,
          message: '输入字段名称和标题不能为空。',
        })
      }
      if (hasDuplicate(names)) {
        issues.push({
          id: `${prefix}-input-dup`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 字段重复`,
          message: '输入字段名不能重复。',
        })
      }
      if (config.fields.some(field => field.type === 'select' && (field.options ?? []).length === 0)) {
        issues.push({
          id: `${prefix}-input-select-empty`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 下拉选项缺失`,
          message: '下拉类型字段至少需要一个选项。',
        })
      }
      if (config.fields.some(field => field.type === 'select' && (field.options ?? []).some(option => !trim(option.label) || !trim(option.value)))) {
        issues.push({
          id: `${prefix}-input-select-invalid`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 下拉选项不完整`,
          message: '下拉选项的名称和编码不能为空。',
        })
      }
      if (config.fields.some((field) => {
        if (field.type !== 'select')
          return false
        const codes = (field.options ?? []).map(option => option.value)
        return hasDuplicate(codes)
      })) {
        issues.push({
          id: `${prefix}-input-select-code-dup`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 下拉编码重复`,
          message: '下拉选项编码不能重复。',
        })
      }
    }

    if (node.data.type === BlockEnum.LLM) {
      const config = ensureNodeConfig(BlockEnum.LLM, node.data.config)
      if (!trim(config.model)) {
        issues.push({
          id: `${prefix}-llm-model`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 模型未配置`,
          message: 'LLM 节点必须配置模型名称。',
        })
      }
      if (!trim(config.userPrompt) && !trim(config.systemPrompt)) {
        issues.push({
          id: `${prefix}-llm-prompt`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} Prompt 缺失`,
          message: 'System Prompt 和 User Prompt 不能同时为空。',
        })
      }
    }

    if (node.data.type === BlockEnum.IfElse) {
      const config = ensureNodeConfig(BlockEnum.IfElse, node.data.config)
      const branchNames = config.conditions.map(item => item.name)
      if (config.conditions.some(condition => !trim(condition.name))) {
        issues.push({
          id: `${prefix}-if-name`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 分支名称为空`,
          message: '每个条件分支都必须配置名称。',
        })
      }
      if (hasDuplicate(branchNames)) {
        issues.push({
          id: `${prefix}-if-name-dup`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 分支名称重复`,
          message: '条件分支名称不能重复。',
        })
      }
      if (!trim(config.elseBranchName)) {
        issues.push({
          id: `${prefix}-if-else-name`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} Else 分支名称为空`,
          message: 'Else 兜底分支名称不能为空。',
        })
      }
      if (config.conditions.some(condition => !trim(condition.left))) {
        issues.push({
          id: `${prefix}-if-left`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 条件变量为空`,
          message: '每个条件都必须配置变量名。',
        })
      }
      if (config.conditions.some(condition => !['empty', 'not_empty'].includes(condition.operator) && !trim(condition.right))) {
        issues.push({
          id: `${prefix}-if-right`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 比较值为空`,
          message: '非空判断以外的条件必须填写比较值。',
        })
      }
      const nodeEdges = edges.filter(edge => edge.source === node.id)
      const missingConditionHandles = config.conditions
        .map((_, index) => buildIfElseBranchHandleId(index))
        .filter(handleId => !nodeEdges.some(edge => edge.sourceHandle === handleId))
      if (missingConditionHandles.length > 0) {
        issues.push({
          id: `${prefix}-if-branch-unlinked`,
          nodeId: node.id,
          level: 'warning',
          title: `${node.data.title} 部分分支未连接`,
          message: '存在条件分支没有连接到下游节点。',
        })
      }
      if (!nodeEdges.some(edge => edge.sourceHandle === IF_ELSE_FALLBACK_HANDLE)) {
        issues.push({
          id: `${prefix}-if-else-unlinked`,
          nodeId: node.id,
          level: 'warning',
          title: `${node.data.title} Else 分支未连接`,
          message: '建议连接 Else 兜底分支，避免遗漏未命中路径。',
        })
      }
    }

    if (node.data.type === BlockEnum.Iteration) {
      const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
      if (!trim(config.iteratorSource)) {
        issues.push({
          id: `${prefix}-iteration-input`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 迭代输入为空`,
          message: '迭代节点必须配置迭代输入变量。',
        })
      }
      if (!trim(config.outputSource)) {
        issues.push({
          id: `${prefix}-iteration-output-source`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 输出来源为空`,
          message: '迭代节点必须配置输出来源变量。',
        })
      }
      if (!trim(config.outputVar)) {
        issues.push({
          id: `${prefix}-iteration-output-var`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 输出变量为空`,
          message: '迭代节点必须配置输出变量名。',
        })
      }
      if (config.isParallel && (config.parallelNums < 1 || config.parallelNums > 100)) {
        issues.push({
          id: `${prefix}-iteration-parallel-range`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 并行数非法`,
          message: '并行模式下并发数需在 1 到 100 之间。',
        })
      }
      if (!config.children.nodes.length) {
        issues.push({
          id: `${prefix}-iteration-children-empty`,
          nodeId: node.id,
          level: 'warning',
          title: `${node.data.title} 子流程为空`,
          message: '建议在迭代节点中配置子流程节点。',
        })
      }
    }

    if (node.data.type === BlockEnum.Code) {
      const config = ensureNodeConfig(BlockEnum.Code, node.data.config)
      if (!trim(config.code)) {
        issues.push({
          id: `${prefix}-code-empty`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 代码为空`,
          message: '代码节点必须填写代码内容。',
        })
      }
      if (config.outputs.length === 0) {
        issues.push({
          id: `${prefix}-code-output-empty`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 输出变量为空`,
          message: '代码节点至少配置一个输出变量。',
        })
      }
      if (hasDuplicate(config.outputs)) {
        issues.push({
          id: `${prefix}-code-output-dup`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 输出变量重复`,
          message: '代码节点输出变量名称不能重复。',
        })
      }
      if (config.outputSchema?.trim()) {
        const schemaCheck = extractSchemaLeafPaths(config.outputSchema)
        if (!schemaCheck.ok) {
          issues.push({
            id: `${prefix}-code-output-schema`,
            nodeId: node.id,
            level: 'error',
            title: `${node.data.title} 输出 Schema 非法`,
            message: `代码节点输出 Schema 解析失败：${schemaCheck.error}`,
          })
        }
      }
      if (config.writebackMappings.some(item => !trim(item.sourcePath) || !trim(item.targetPath))) {
        issues.push({
          id: `${prefix}-code-writeback-invalid`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 写入参数映射不完整`,
          message: '代码节点写入参数映射的 sourcePath/targetPath 不能为空。',
        })
      }
      issues.push(
        ...validateArrayWritebackMappings(prefix, node.id, node.data.title, config.writebackMappings),
      )
    }

    if (node.data.type === BlockEnum.HttpRequest) {
      const config = ensureNodeConfig(BlockEnum.HttpRequest, node.data.config)
      if (!trim(config.url)) {
        issues.push({
          id: `${prefix}-http-url`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} URL 为空`,
          message: 'HTTP 节点必须配置请求 URL。',
        })
      }
      if (config.query.some(item => !trim(item.key) && !!trim(item.value))) {
        issues.push({
          id: `${prefix}-http-query-key`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} Query 参数无键名`,
          message: 'Query 参数填写值时必须填写 key。',
        })
      }
      if (config.headers.some(item => !trim(item.key) && !!trim(item.value))) {
        issues.push({
          id: `${prefix}-http-header-key`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} Header 参数无键名`,
          message: 'Header 参数填写值时必须填写 key。',
        })
      }
      if (config.outputSchema?.trim()) {
        const schemaCheck = extractSchemaLeafPaths(config.outputSchema)
        if (!schemaCheck.ok) {
          issues.push({
            id: `${prefix}-http-output-schema`,
            nodeId: node.id,
            level: 'error',
            title: `${node.data.title} 响应 Schema 非法`,
            message: `HTTP 节点响应 Schema 解析失败：${schemaCheck.error}`,
          })
        }
      }
      if (config.writebackMappings.some(item => !trim(item.sourcePath) || !trim(item.targetPath))) {
        issues.push({
          id: `${prefix}-http-writeback-invalid`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 写入参数映射不完整`,
          message: 'HTTP 节点写入参数映射的 sourcePath/targetPath 不能为空。',
        })
      }
      issues.push(
        ...validateArrayWritebackMappings(prefix, node.id, node.data.title, config.writebackMappings),
      )
    }

    if (node.data.type === BlockEnum.ApiRequest) {
      const config = ensureNodeConfig(BlockEnum.ApiRequest, node.data.config)
      if (!trim(config.route.path)) {
        issues.push({
          id: `${prefix}-api-route`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 路由未选择`,
          message: 'API 请求节点必须选择一个后端路由。',
        })
      }

      const requiredParams = config.params.filter(item => item.validation?.required)
      const valueMap = new Map(config.paramValues.map(item => [`${item.in}:${item.name}`, item.value]))
      const missing = requiredParams
        .filter(item => !trim(valueMap.get(`${item.in}:${item.name}`) || ''))
        .map(item => `${item.in}.${item.name}`)
      if (missing.length > 0) {
        issues.push({
          id: `${prefix}-api-required-missing`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 必填参数未配置`,
          message: `必填参数未配置：${missing.join('，')}`,
        })
      }

      if (config.writebackMappings.some(item => !trim(item.sourcePath) || !trim(item.targetPath))) {
        issues.push({
          id: `${prefix}-api-writeback-invalid`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 写入参数映射不完整`,
          message: 'API 请求节点写入参数映射的 sourcePath/targetPath 不能为空。',
        })
      }
      issues.push(
        ...validateArrayWritebackMappings(prefix, node.id, node.data.title, config.writebackMappings),
      )
    }

    if (node.data.type === BlockEnum.End) {
      const config = ensureNodeConfig(BlockEnum.End, node.data.config)
      if (config.outputs.length === 0) {
        issues.push({
          id: `${prefix}-end-empty`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 输出为空`,
          message: '结束节点至少需要一个输出变量。',
        })
      }
      if (config.outputs.some(item => !trim(item.name) || !trim(item.source))) {
        issues.push({
          id: `${prefix}-end-invalid`,
          nodeId: node.id,
          level: 'error',
          title: `${node.data.title} 输出不完整`,
          message: '结束节点输出变量名和来源不能为空。',
        })
      }
    }
  })

  return issues
}
