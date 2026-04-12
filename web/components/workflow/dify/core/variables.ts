import { ensureNodeConfig } from './node-config'
import { extractJsonLeafPaths, extractSchemaLeafPaths } from './json-schema'
import { BlockEnum, type DifyNode, type WorkflowGlobalVariable, type WorkflowParameter, type WorkflowVariableScope } from './types'

export type VariableScope = WorkflowVariableScope

export type WorkflowVariableOption = {
  key: string
  nodeId: string
  nodeTitle: string
  param: string
  valueType: VariableScope
  placeholder: string
  displayLabel: string
}

const getRuntimeVariableNodeId = (node: DifyNode) => {
  if (node.data.parentIterationId && node.data.nestedNodeId)
    return node.data.nestedNodeId
  return node.id
}

export type WorkflowVariableSelectGroupOption = {
  label: string
  options: Array<{
    value: string
    label: string
  }>
}

export type WorkflowVariableTreeOption = {
  title: string
  value: string
  key: string
  selectable?: boolean
  children?: WorkflowVariableTreeOption[]
}

const normalizeScopeFromString = (value: string): VariableScope => {
  if (value === 'file')
    return 'file'
  if (value === 'file-list')
    return 'array'
  if (value === 'array')
    return 'array'
  if (value === 'object')
    return 'object'
  if (value === 'json_object')
    return 'object'
  if (value === 'number')
    return 'number'
  if (value === 'boolean' || value === 'checkbox')
    return 'boolean'
  return 'string'
}

const normalizeScopeFromUnknown = (_value: string): VariableScope => {
  return 'string'
}

const normalizeNodeOutputType = (nodeType: BlockEnum, outputName: string): VariableScope => {
  if (nodeType === BlockEnum.LLM)
    return 'string'
  if (nodeType === BlockEnum.IfElse)
    return 'boolean'
  if (nodeType === BlockEnum.HttpRequest && outputName.toLowerCase().includes('body'))
    return 'object'
  return 'string'
}

const parseObjectLeafPathsFromDefault = (rawDefault?: string): string[] => {
  if (!rawDefault?.trim())
    return []

  try {
    const parsed = JSON.parse(rawDefault) as unknown
    const collect = (value: unknown, prefix: string): string[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return prefix ? [prefix] : []
      const entries = Object.entries(value as Record<string, unknown>)
      if (!entries.length)
        return prefix ? [prefix] : []
      return entries.flatMap(([key, child]) => collect(child, prefix ? `${prefix}.${key}` : key))
    }
    return [...new Set(collect(parsed, ''))]
  }
  catch {
    return []
  }
}

const parseObjectLeafPathsFromJson = (rawJson?: string): string[] => {
  if (!rawJson?.trim())
    return []

  const parsed = extractJsonLeafPaths(rawJson)
  if (!parsed.ok)
    return []

  return parsed.paths
}

const parseStructuredLeafPathsFromDefault = (rawDefault?: string): string[] => {
  if (!rawDefault?.trim())
    return []

  try {
    const parsed = JSON.parse(rawDefault) as unknown
    const visit = (value: unknown, prefix: string): string[] => {
      if (value === null || value === undefined)
        return prefix ? [prefix] : []
      if (Array.isArray(value)) {
        const container = prefix ? [prefix, `${prefix}[]`] : ['[]']
        if (value.length === 0)
          return container
        return [...container, ...value.flatMap(item => visit(item, prefix ? `${prefix}[]` : '[]'))]
      }
      if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
        if (entries.length === 0)
          return prefix ? [prefix] : []
        return [
          ...(prefix ? [prefix] : []),
          ...entries.flatMap(([key, child]) => visit(child, prefix ? `${prefix}.${key}` : key)),
        ]
      }
      return prefix ? [prefix] : []
    }
    return [...new Set(visit(parsed, ''))].filter(Boolean)
  }
  catch {
    return []
  }
}

const parseStructuredLeafPathsFromJson = (rawJson?: string): string[] => {
  if (!rawJson?.trim())
    return []
  const parsed = extractJsonLeafPaths(rawJson)
  if (!parsed.ok)
    return []
  return parsed.paths
}

const parseStructuredLeafPathsFromSchema = (rawSchema?: string): string[] => {
  if (!rawSchema?.trim())
    return []
  const parsed = extractSchemaLeafPaths(rawSchema)
  if (!parsed.ok)
    return []
  return parsed.paths
    .map((path) => {
      if (!path || path === '$')
        return ''
      return path.replace(/^\$\./, '').replace(/^\$/, '')
    })
    .filter(Boolean)
}

const joinBaseAndChildPath = (baseParam: string, childPath: string) => {
  if (!childPath)
    return baseParam
  if (childPath === '[]')
    return `${baseParam}[]`
  if (childPath.startsWith('[]'))
    return `${baseParam}${childPath}`
  return `${baseParam}.${childPath}`
}

const buildDisplayLabel = (nodeTitle: string, fullParamPath: string) => {
  return `${nodeTitle}.${fullParamPath}`
}

const isIterationEntryStartNode = (node: DifyNode) => {
  return node.data.type === BlockEnum.Start
    && Boolean(node.data.parentIterationId)
    && Boolean(node.data.isIterationEntry)
}

const normalizeDynamicPath = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed)
    return ''
  const directMatch = trimmed.match(/^\{\{\s*([^{}]+?)\s*\}\}$/)
  if (directMatch)
    return directMatch[1].trim()
  return trimmed
}

const buildPathVariants = (value: string) => {
  const normalized = normalizeDynamicPath(value)
  if (!normalized)
    return []
  return [...new Set([
    normalized,
    normalized.replace(/\[\]/g, ''),
  ].filter(Boolean))]
}

const inferScopeFromPath = (path: string): VariableScope => {
  if (path.includes('[]'))
    return 'array'
  return 'all'
}

const collectIterationItemDerivedOptions = (
  options: WorkflowVariableOption[],
  parentId: string,
  parentTitle: string,
  iteratorSource: string,
  itemVar: string,
): WorkflowVariableOption[] => {
  const sourceOptions = new Map(options.map(option => [option.key, option]))
  const derived: WorkflowVariableOption[] = []
  const iterationGroupNodeId = `${parentId}::__iteration_context__`
  const itemNodeTitle = `${parentTitle}·循环项`

  buildPathVariants(iteratorSource).forEach((sourcePath) => {
    const sourceOption = sourceOptions.get(sourcePath)
    if (!sourceOption)
      return

    const sourceParam = sourceOption.param
    const prefixes = [...new Set([
      `${sourceParam}[]`,
      `${sourceParam}[].`,
      sourceParam.endsWith('[]') ? sourceParam : '',
      sourceParam.endsWith('[]') ? `${sourceParam}.` : '',
    ].filter(Boolean))]

    options.forEach((option) => {
      if (option.key === sourceOption.key)
        return

      const matchedPrefix = prefixes.find((prefix) => {
        const normalizedPrefix = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix
        return option.param === normalizedPrefix || option.param.startsWith(prefix)
      })
      if (!matchedPrefix)
        return

      const normalizedPrefix = matchedPrefix.endsWith('.') ? matchedPrefix.slice(0, -1) : matchedPrefix
      const rawSuffix = option.param === normalizedPrefix
        ? ''
        : option.param.slice(matchedPrefix.length)
      const suffix = rawSuffix.replace(/^\./, '')
      const nextParam = suffix ? joinBaseAndChildPath(itemVar, suffix) : itemVar
      derived.push({
        key: `${parentId}.${nextParam}`,
        nodeId: iterationGroupNodeId,
        nodeTitle: itemNodeTitle,
        param: nextParam,
        valueType: option.valueType === 'object' || option.valueType === 'array' ? option.valueType : inferScopeFromPath(suffix),
        placeholder: `{{${parentId}.${nextParam}}}`,
        displayLabel: nextParam,
      })
    })
  })

  return derived
}

export const buildWorkflowVariableOptions = (
  nodes: DifyNode[],
  workflowParameters: WorkflowParameter[],
  globalVariables: WorkflowGlobalVariable[],
  activeNode?: DifyNode | null,
): WorkflowVariableOption[] => {
  const options: WorkflowVariableOption[] = []
  const pushVariableOption = (
    nodeId: string,
    nodeTitle: string,
    fullParamPath: string,
    valueType: VariableScope,
    runtimeNodeId?: string,
  ) => {
    const resolvedRuntimeNodeId = runtimeNodeId || nodeId
    options.push({
      key: `${nodeId}.${fullParamPath}`,
      nodeId,
      nodeTitle,
      param: fullParamPath,
      valueType,
      placeholder: `{{${resolvedRuntimeNodeId}.${fullParamPath}}}`,
      displayLabel: buildDisplayLabel(nodeTitle, fullParamPath),
    })
  }

  ;[
    { name: 'username', scope: 'string' as const },
    { name: 'warningAccount', scope: 'string' as const },
    { name: 'warningPassword', scope: 'string' as const },
    { name: 'aiBaseUrl', scope: 'string' as const },
    { name: 'aiApiKey', scope: 'string' as const },
  ].forEach((field) => {
    pushVariableOption('user', '用户属性', field.name, field.scope)
  })

  workflowParameters.forEach((parameter) => {
    const nodeId = 'workflow'
    const nodeTitle = '流程参数'
    const baseParam = parameter.name
    if (!baseParam)
      return

    const rootScope = normalizeScopeFromString(parameter.valueType)
    pushVariableOption(nodeId, nodeTitle, baseParam, rootScope)

    if (parameter.valueType === 'object' || parameter.valueType === 'array') {
      const jsonPaths = parseStructuredLeafPathsFromJson(parameter.json)
      const childPaths = jsonPaths.length ? jsonPaths : parseStructuredLeafPathsFromDefault(parameter.defaultValue)
      childPaths.forEach((childPath) => {
        const fullPath = joinBaseAndChildPath(baseParam, childPath)
        pushVariableOption(nodeId, nodeTitle, fullPath, childPath.includes('[]') ? 'array' : 'all')
      })
    }
  })

  globalVariables.forEach((variable) => {
    const nodeId = 'global'
    const nodeTitle = '全局参数'
    const baseParam = variable.name
    if (!baseParam)
      return

    const rootScope = normalizeScopeFromString(variable.valueType)
    pushVariableOption(nodeId, nodeTitle, baseParam, rootScope)

    if (variable.valueType === 'object' || variable.valueType === 'array') {
      const jsonPaths = parseStructuredLeafPathsFromJson(variable.json)
      const childPaths = jsonPaths.length ? jsonPaths : parseStructuredLeafPathsFromDefault(variable.defaultValue)
      childPaths.forEach((childPath) => {
        const fullPath = joinBaseAndChildPath(baseParam, childPath)
        pushVariableOption(nodeId, nodeTitle, fullPath, childPath.includes('[]') ? 'array' : 'all')
      })
    }
  })

  nodes.forEach((node) => {
    const nodeId = node.id
    const runtimeNodeId = getRuntimeVariableNodeId(node)
    const nodeTitle = node.data.title || node.id
    const type = node.data.type

    if (type === BlockEnum.Start) {
      if (isIterationEntryStartNode(node))
        return
      const config = ensureNodeConfig(BlockEnum.Start, node.data.config)
      config.variables.forEach((item) => {
        if (!item.name)
          return
        options.push({
          key: `${nodeId}.${item.name}`,
          nodeId,
          nodeTitle,
          param: item.name,
          valueType: normalizeScopeFromString(item.type),
          placeholder: `{{${runtimeNodeId}.${item.name}}}`,
          displayLabel: `${nodeTitle}.${item.name}`,
        })
        if (item.type === 'json_object') {
          const schemaPaths = parseStructuredLeafPathsFromSchema(item.jsonSchema)
          const defaultPaths = typeof item.defaultValue === 'string'
            ? parseStructuredLeafPathsFromDefault(item.defaultValue)
            : []
          const childPaths = schemaPaths.length ? schemaPaths : defaultPaths
          childPaths.forEach((childPath) => {
            const fullPath = joinBaseAndChildPath(item.name, childPath)
            options.push({
              key: `${nodeId}.${fullPath}`,
              nodeId,
              nodeTitle,
              param: fullPath,
              valueType: inferScopeFromPath(childPath),
              placeholder: `{{${runtimeNodeId}.${fullPath}}}`,
              displayLabel: `${nodeTitle}.${fullPath}`,
            })
          })
        }
      })
      return
    }

    if (type === BlockEnum.Input) {
      const config = ensureNodeConfig(BlockEnum.Input, node.data.config)
      config.fields.forEach((field) => {
        if (!field.name)
          return
        const valueType = field.type === 'number' ? 'number' : field.type === 'checkbox' ? 'boolean' : 'string'
        options.push({
          key: `${nodeId}.${field.name}`,
          nodeId,
          nodeTitle,
          param: field.name,
          valueType,
          placeholder: `{{${runtimeNodeId}.${field.name}}}`,
          displayLabel: `${nodeTitle}.${field.name}`,
        })
      })
      return
    }

    if (type === BlockEnum.Code) {
      const config = ensureNodeConfig(BlockEnum.Code, node.data.config)
      config.outputs.forEach((outputName) => {
        if (!outputName)
          return
        options.push({
          key: `${nodeId}.${outputName}`,
          nodeId,
          nodeTitle,
          param: outputName,
          valueType: normalizeScopeFromUnknown(outputName),
          placeholder: `{{${runtimeNodeId}.${outputName}}}`,
          displayLabel: `${nodeTitle}.${outputName}`,
        })
      })
      const outputSchemaPaths = parseStructuredLeafPathsFromSchema(config.outputSchema)
      outputSchemaPaths.forEach((childPath) => {
        options.push({
          key: `${nodeId}.${childPath}`,
          nodeId,
          nodeTitle,
          param: childPath,
          valueType: inferScopeFromPath(childPath),
          placeholder: `{{${runtimeNodeId}.${childPath}}}`,
          displayLabel: `${nodeTitle}.${childPath}`,
        })
      })
      return
    }

    if (type === BlockEnum.ApiRequest) {
      ;[
        { name: 'ok', scope: 'boolean' as const },
        { name: 'statusCode', scope: 'number' as const },
        { name: 'httpStatus', scope: 'number' as const },
        { name: 'message', scope: 'string' as const },
        { name: 'data', scope: 'object' as const },
        { name: 'response', scope: 'object' as const },
        { name: 'url', scope: 'string' as const },
        { name: 'method', scope: 'string' as const },
      ].forEach((output) => {
        pushVariableOption(nodeId, nodeTitle, output.name, output.scope, runtimeNodeId)
      })
      return
    }

    if (type === BlockEnum.Iteration) {
      const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
      if (config.outputVar) {
        pushVariableOption(nodeId, nodeTitle, config.outputVar, 'object', runtimeNodeId)
        config.children.nodes
          .filter(childNode => childNode.data.type === BlockEnum.End)
          .forEach((childNode) => {
            const endConfig = ensureNodeConfig(BlockEnum.End, childNode.data.config)
            endConfig.outputs.forEach((output) => {
              const outputName = output.name?.trim()
              if (!outputName)
                return
              pushVariableOption(nodeId, nodeTitle, `${config.outputVar}.${outputName}`, 'array', runtimeNodeId)
            })
          })
      }
      return
    }

    if (type === BlockEnum.End) {
      const config = ensureNodeConfig(BlockEnum.End, node.data.config)
      config.outputs.forEach((output) => {
        if (!output.name)
          return
        options.push({
          key: `${nodeId}.${output.name}`,
          nodeId,
          nodeTitle,
          param: output.name,
          valueType: normalizeScopeFromUnknown(output.name),
          placeholder: `{{${runtimeNodeId}.${output.name}}}`,
          displayLabel: `${nodeTitle}.${output.name}`,
        })
      })
      return
    }

    if (type === BlockEnum.LLM) {
      const config = ensureNodeConfig(BlockEnum.LLM, node.data.config)
      const mainOutput = (config.outputVar || '').trim() || 'result'
      const mainScope: VariableScope = config.outputType === 'json' ? 'object' : 'string'
      pushVariableOption(nodeId, nodeTitle, mainOutput, mainScope)
      // 兼容旧模板：保留 text 别名。
      if (mainOutput !== 'text')
        pushVariableOption(nodeId, nodeTitle, 'text', mainScope)
      return
    }

    if (type === BlockEnum.HttpRequest) {
      const config = ensureNodeConfig(BlockEnum.HttpRequest, node.data.config)
      const outputSchemaPaths = parseStructuredLeafPathsFromSchema(config.outputSchema)
      outputSchemaPaths.forEach((childPath) => {
        options.push({
          key: `${nodeId}.${childPath}`,
          nodeId,
          nodeTitle,
          param: childPath,
          valueType: inferScopeFromPath(childPath),
          placeholder: `{{${runtimeNodeId}.${childPath}}}`,
          displayLabel: `${nodeTitle}.${childPath}`,
        })
      })
    }

    const defaultOutputs = ['text']
    defaultOutputs.forEach((outputName) => {
      options.push({
        key: `${nodeId}.${outputName}`,
        nodeId,
        nodeTitle,
        param: outputName,
        valueType: normalizeNodeOutputType(type, outputName),
        placeholder: `{{${runtimeNodeId}.${outputName}}}`,
        displayLabel: `${nodeTitle}.${outputName}`,
      })
    })
  })

  const unique = new Map<string, WorkflowVariableOption>()
  options.forEach((item) => {
    unique.set(item.key, item)
  })

  const merged = [...unique.values()]

  if (activeNode?.data.parentIterationId) {
    const parentId = activeNode.data.parentIterationId
    const parentNode = nodes.find(node => node.id === parentId && node.data.type === BlockEnum.Iteration)
    if (parentNode) {
      const config = ensureNodeConfig(BlockEnum.Iteration, parentNode.data.config)
      const itemVar = config.itemVar || 'item'
      const indexVar = config.indexVar || 'index'
      merged.push({
        key: `${parentId}.${itemVar}`,
        nodeId: `${parentId}::__iteration_context__`,
        nodeTitle: `${parentNode.data.title || parentId}·循环项`,
        param: itemVar,
        valueType: 'object',
        placeholder: `{{${parentId}.${itemVar}}}`,
        displayLabel: itemVar,
      })
      collectIterationItemDerivedOptions(
        merged,
        parentId,
        parentNode.data.title || parentId,
        config.iteratorSource || '',
        itemVar,
      ).forEach(item => merged.push(item))
      merged.push({
        key: `${parentId}.${indexVar}`,
        nodeId: `${parentId}::__iteration_context__`,
        nodeTitle: `${parentNode.data.title || parentId}·循环项`,
        param: indexVar,
        valueType: 'number',
        placeholder: `{{${parentId}.${indexVar}}}`,
        displayLabel: indexVar,
      })
      merged.push({
        key: `${parentId}.state`,
        nodeId: `${parentId}::__iteration_context__`,
        nodeTitle: `${parentNode.data.title || parentId}·循环状态`,
        param: 'state',
        valueType: 'object',
        placeholder: `{{${parentId}.state}}`,
        displayLabel: 'state',
      })
    }
  }

  const finalUnique = new Map<string, WorkflowVariableOption>()
  merged.forEach((item) => {
    finalUnique.set(item.key, item)
  })
  return [...finalUnique.values()]
}

export const buildWorkflowVariableSelectGroupOptions = (
  options: WorkflowVariableOption[],
): WorkflowVariableSelectGroupOption[] => {
  const grouped = new Map<string, WorkflowVariableSelectGroupOption>()

  options.forEach((option) => {
    const groupKey = option.nodeId || option.nodeTitle
    const groupLabel = option.nodeTitle || option.nodeId
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        label: groupLabel,
        options: [],
      })
    }

    grouped.get(groupKey)?.options.push({
      value: option.key,
      label: option.param,
    })
  })

  return [...grouped.values()]
}

export const buildWorkflowVariableTreeOptions = (
  options: WorkflowVariableOption[],
): WorkflowVariableTreeOption[] => {
  const grouped = new Map<string, WorkflowVariableTreeOption>()

  options.forEach((option) => {
    const groupKey = option.nodeId || option.nodeTitle
    const groupLabel = option.nodeTitle || option.nodeId

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        title: groupLabel,
        value: `__group__:${groupKey}`,
        key: `__group__:${groupKey}`,
        selectable: false,
        children: [],
      })
    }

    const groupNode = grouped.get(groupKey)!
    const parts = option.param.split('.').filter(Boolean)
    let currentChildren = groupNode.children!
    let currentPath = ''

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}.${part}` : part
      const isLeaf = index === parts.length - 1
      const nodeValue = isLeaf ? option.key : `__path__:${groupKey}.${currentPath}`
      let currentNode = currentChildren.find(item => item.title === part)

      if (!currentNode) {
        currentNode = {
          title: part,
          value: nodeValue,
          key: nodeValue,
          selectable: isLeaf,
          children: [],
        }
        currentChildren.push(currentNode)
      }

      if (isLeaf) {
        currentNode.value = option.key
        currentNode.key = option.key
        currentNode.selectable = true
      }

      currentChildren = currentNode.children ?? (currentNode.children = [])
    })
  })

  return [...grouped.values()]
}

export const formatValueForDisplay = (rawValue: unknown, options: WorkflowVariableOption[]): string => {
  if (rawValue === undefined || rawValue === null || rawValue === '')
    return ''
  const safeRawValue = (() => {
    if (typeof rawValue === 'string')
      return rawValue
    try {
      return JSON.stringify(rawValue)
    }
    catch {
      return String(rawValue)
    }
  })()

  const map = new Map(options.map(option => [option.placeholder, option.displayLabel]))
  return safeRawValue.replace(/\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)\s*\}\}/g, (full, nodeId, param) => {
    const placeholder = `{{${nodeId}.${param}}}`
    const display = map.get(placeholder)
    if (!display)
      return full
    return `{{${display}}}`
  })
}

export const parseDisplayToRaw = (displayValue: string, options: WorkflowVariableOption[]): string => {
  if (!displayValue)
    return ''

  const labelToPlaceholder = new Map(options.map(option => [option.displayLabel, option.placeholder]))
  const replaceLabel = (label: string, fallback: string) => {
    const trimmed = String(label).trim()
    const placeholder = labelToPlaceholder.get(trimmed)
    if (!placeholder)
      return fallback
    return placeholder
  }

  const replacedDouble = displayValue.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (full, label) => {
    return replaceLabel(label, full)
  })

  // Backward compatible: allow legacy `{label}` format.
  return replacedDouble.replace(/\{([^{}]+)\}/g, (full, label) => {
    return replaceLabel(label, full)
  })
}
