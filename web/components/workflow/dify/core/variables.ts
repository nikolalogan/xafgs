import { ensureNodeConfig } from './node-config'
import { extractJsonLeafPaths } from './json-schema'
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

const buildDisplayLabel = (nodeTitle: string, fullParamPath: string) => {
  const parts = fullParamPath.split('.').filter(Boolean)
  if (parts.length <= 1)
    return `${nodeTitle}.${fullParamPath}`
  const leaf = parts[parts.length - 1]
  const parent = parts.slice(0, -1).join('.')
  const indent = '  '.repeat(Math.max(0, parts.length - 2))
  return `${nodeTitle}.${indent}└ ${leaf} (${parent}.${leaf})`
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
  ) => {
    options.push({
      key: `${nodeId}.${fullParamPath}`,
      nodeId,
      nodeTitle,
      param: fullParamPath,
      valueType,
      placeholder: `{{${nodeId}.${fullParamPath}}}`,
      displayLabel: buildDisplayLabel(nodeTitle, fullParamPath),
    })
  }

  ;[
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

    if (parameter.valueType === 'object') {
      const jsonPaths = parseObjectLeafPathsFromJson(parameter.json)
      const childPaths = jsonPaths.length ? jsonPaths : parseObjectLeafPathsFromDefault(parameter.defaultValue)
      childPaths.forEach((childPath) => {
        pushVariableOption(nodeId, nodeTitle, `${baseParam}.${childPath}`, 'all')
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

    if (variable.valueType === 'object') {
      const jsonPaths = parseObjectLeafPathsFromJson(variable.json)
      const childPaths = jsonPaths.length ? jsonPaths : parseObjectLeafPathsFromDefault(variable.defaultValue)
      childPaths.forEach((childPath) => {
        pushVariableOption(nodeId, nodeTitle, `${baseParam}.${childPath}`, 'all')
      })
    }
  })

  nodes.forEach((node) => {
    const nodeId = node.id
    const nodeTitle = node.data.title || node.id
    const type = node.data.type

    if (type === BlockEnum.Start) {
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
          placeholder: `{{${nodeId}.${item.name}}}`,
          displayLabel: `${nodeTitle}.${item.name}`,
        })
      })
      return
    }

    if (type === BlockEnum.Input) {
      const config = ensureNodeConfig(BlockEnum.Input, node.data.config)
      config.fields.forEach((field) => {
        if (!field.name)
          return
        const valueType = field.type === 'number' ? 'number' : 'string'
        options.push({
          key: `${nodeId}.${field.name}`,
          nodeId,
          nodeTitle,
          param: field.name,
          valueType,
          placeholder: `{{${nodeId}.${field.name}}}`,
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
          placeholder: `{{${nodeId}.${outputName}}}`,
          displayLabel: `${nodeTitle}.${outputName}`,
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
        pushVariableOption(nodeId, nodeTitle, output.name, output.scope)
      })
      return
    }

    if (type === BlockEnum.Iteration) {
      const config = ensureNodeConfig(BlockEnum.Iteration, node.data.config)
      if (config.outputVar) {
        options.push({
          key: `${nodeId}.${config.outputVar}`,
          nodeId,
          nodeTitle,
          param: config.outputVar,
          valueType: config.flattenOutput ? 'all' : 'array',
          placeholder: `{{${nodeId}.${config.outputVar}}}`,
          displayLabel: `${nodeTitle}.${config.outputVar}`,
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
          placeholder: `{{${nodeId}.${output.name}}}`,
          displayLabel: `${nodeTitle}.${output.name}`,
        })
      })
      return
    }

    const defaultOutputs = ['text']
    defaultOutputs.forEach((outputName) => {
      options.push({
        key: `${nodeId}.${outputName}`,
        nodeId,
        nodeTitle,
        param: outputName,
        valueType: normalizeNodeOutputType(type, outputName),
        placeholder: `{{${nodeId}.${outputName}}}`,
        displayLabel: `${nodeTitle}.${outputName}`,
      })
    })
  })

  const unique = new Map<string, WorkflowVariableOption>()
  options.forEach((item) => {
    unique.set(item.key, item)
  })

  const merged = [...unique.values()]

  if (activeNode?.data._iterationRole === 'child' && activeNode.data._iterationParentId) {
    const parentId = activeNode.data._iterationParentId
    const parentNode = nodes.find(node => node.id === parentId && node.data.type === BlockEnum.Iteration)
    if (parentNode) {
      const config = ensureNodeConfig(BlockEnum.Iteration, parentNode.data.config)
      const itemVar = config.itemVar || 'item'
      const indexVar = config.indexVar || 'index'
      merged.push({
        key: `${parentId}.${itemVar}`,
        nodeId: parentId,
        nodeTitle: parentNode.data.title || parentId,
        param: itemVar,
        valueType: 'object',
        placeholder: `{{${parentId}.${itemVar}}}`,
        displayLabel: `${parentNode.data.title || parentId}.${itemVar}`,
      })
      merged.push({
        key: `${parentId}.${indexVar}`,
        nodeId: parentId,
        nodeTitle: parentNode.data.title || parentId,
        param: indexVar,
        valueType: 'number',
        placeholder: `{{${parentId}.${indexVar}}}`,
        displayLabel: `${parentNode.data.title || parentId}.${indexVar}`,
      })
    }
  }

  const finalUnique = new Map<string, WorkflowVariableOption>()
  merged.forEach((item) => {
    finalUnique.set(item.key, item)
  })
  return [...finalUnique.values()]
}

export const formatValueForDisplay = (rawValue: string, options: WorkflowVariableOption[]): string => {
  if (!rawValue)
    return ''

  const map = new Map(options.map(option => [option.placeholder, option.displayLabel]))
  return rawValue.replace(/\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)\s*\}\}/g, (full, nodeId, param) => {
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
