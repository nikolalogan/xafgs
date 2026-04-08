import type { WorkflowNode } from '../workflow-types'
import { buildIfElseBranchHandleId, IF_ELSE_FALLBACK_HANDLE } from '../workflow-ifelse'

export type NodeExecutorContext = {
  node: WorkflowNode
  variables: Record<string, unknown>
  nodeInput?: Record<string, unknown>
}

export type NodeExecutorResult =
  | {
      type: 'success'
      output?: Record<string, unknown>
      writebacks?: Array<{ targetPath: string; value: unknown }>
    }
  | { type: 'waiting_input'; schema: Record<string, unknown> }
  | { type: 'branch'; handleId: string; branchName: string; output?: Record<string, unknown> }
  | { type: 'failed'; error: string }

export type NodeExecutor = {
  execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult>
}

const toObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>
  return {}
}

const normalizePath = (path: string) => path
  .trim()
  .replace(/^\$\./, '')
  .replace(/^\$/, '')
  .replace(/\[(\d+)\]/g, '.$1')
  .replace(/\[\]/g, '.0')

const hasValue = (value: unknown) => {
  if (value === null || value === undefined)
    return false
  if (typeof value === 'string')
    return value.trim().length > 0
  if (Array.isArray(value))
    return value.length > 0
  return true
}

const parseScalar = (value: unknown): unknown => {
  if (typeof value !== 'string')
    return value
  const trimmed = value.trim()
  if (!trimmed)
    return ''
  if (trimmed === 'true')
    return true
  if (trimmed === 'false')
    return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed))
    return Number(trimmed)
  try {
    return JSON.parse(trimmed)
  }
  catch {
    return value
  }
}

const getByPath = (source: Record<string, unknown>, path: string): unknown => {
  const keys = normalizePath(path).split('.').map(item => item.trim()).filter(Boolean)
  if (keys.length === 0)
    return undefined

  let current: unknown = source
  for (const key of keys) {
    if (current === null || current === undefined)
      return undefined

    if (Array.isArray(current)) {
      const index = Number(key)
      if (!Number.isInteger(index))
        return undefined
      current = current[index]
      continue
    }

    if (typeof current !== 'object')
      return undefined

    current = (current as Record<string, unknown>)[key]
  }
  return current
}

const readFromOutputByPath = (output: Record<string, unknown>, path: string): unknown => {
  const normalized = normalizePath(path)
  if (!normalized)
    return output
  if (normalized === '$')
    return output
  return getByPath(output, normalized)
}

const renderTemplate = (value: string, variables: Record<string, unknown>) => {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_full, key) => {
    const resolved = getByPath(variables, String(key))
    if (resolved === undefined || resolved === null)
      return ''
    if (typeof resolved === 'object')
      return JSON.stringify(resolved)
    return String(resolved)
  })
}

const renderTemplateWithMissing = (value: string, variables: Record<string, unknown>) => {
  const missing = new Set<string>()
  value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_full, rawKey) => {
    const key = String(rawKey || '').trim()
    if (!key)
      return ''
    const resolved = getByPath(variables, key)
    if (!hasValue(resolved))
      missing.add(key)
    return ''
  })

  const rendered = renderTemplate(value, variables)
  return { rendered, missing: [...missing].sort() }
}

const buildWritebacks = (
  mappings: unknown,
  output: Record<string, unknown>,
): Array<{ targetPath: string; value: unknown }> => {
  if (!Array.isArray(mappings))
    return []
  return mappings
    .map((item) => {
      const sourcePath = typeof item?.sourcePath === 'string' ? item.sourcePath.trim() : ''
      const targetPath = typeof item?.targetPath === 'string' ? item.targetPath.trim() : ''
      if (!sourcePath || !targetPath)
        return null
      const value = sourcePath === '$' ? output : readFromOutputByPath(output, sourcePath)
      return { targetPath, value }
    })
    .filter(Boolean) as Array<{ targetPath: string; value: unknown }>
}

const buildNodeWritebacks = (
  mappings: unknown,
  source: unknown,
): Array<{ targetPath: string; value: unknown }> => {
  return buildWritebacks(mappings, toObject(source))
}

const resolveValue = (raw: unknown, variables: Record<string, unknown>): unknown => {
  if (typeof raw !== 'string')
    return raw

  const placeholderMatch = raw.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/)
  if (placeholderMatch)
    return getByPath(variables, placeholderMatch[1].trim())

  if (raw.includes('.')) {
    const pathValue = getByPath(variables, raw.trim())
    if (pathValue !== undefined)
      return pathValue
  }

  return parseScalar(raw)
}

const compareCondition = (left: unknown, operator: string, right: unknown): boolean => {
  if (operator === 'empty')
    return !hasValue(left)
  if (operator === 'not_empty')
    return hasValue(left)

  if (operator === 'contains')
    return String(left ?? '').includes(String(right ?? ''))
  if (operator === 'not_contains')
    return !String(left ?? '').includes(String(right ?? ''))
  if (operator === 'eq')
    return left === right
  if (operator === 'neq')
    return left !== right
  if (operator === 'gt')
    return Number(left) > Number(right)
  if (operator === 'lt')
    return Number(left) < Number(right)

  return false
}

class StartNodeExecutor implements NodeExecutor {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    return { type: 'success', output: { ...ctx.variables } }
  }
}

class InputNodeExecutor implements NodeExecutor {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    const config = toObject(ctx.node.data.config)
    const fields = Array.isArray(config.fields) ? config.fields : []
    const schema = {
      fields: fields.map((field) => {
        const item = toObject(field)
        return {
          name: typeof item.name === 'string' ? item.name : '',
          label: typeof item.label === 'string' ? item.label : '',
          type: typeof item.type === 'string' ? item.type : 'text',
          required: Boolean(item.required),
          options: Array.isArray(item.options)
            ? item.options.map((option) => {
                if (option && typeof option === 'object') {
                  const value = typeof (option as { value?: unknown }).value === 'string'
                    ? (option as { value: string }).value
                    : String((option as { value?: unknown }).value ?? '')
                  const label = typeof (option as { label?: unknown }).label === 'string'
                    ? (option as { label: string }).label
                    : value
                  return { label, value }
                }
                return String(option ?? '')
              })
            : [],
          defaultValue: item.defaultValue ?? '',
          visibleWhen: typeof item.visibleWhen === 'string' ? item.visibleWhen : undefined,
          validateWhen: typeof item.validateWhen === 'string' ? item.validateWhen : undefined,
        }
      }),
      prompt: typeof config.prompt === 'string' ? config.prompt : '',
    }
    if (!ctx.nodeInput)
      return { type: 'waiting_input', schema }

    const normalizedInput: Record<string, unknown> = {}
    for (const field of schema.fields) {
      if (!field.name)
        return { type: 'failed', error: `输入字段缺少 name：${field.label || '(未命名字段)'}` }

      const rawValue = ctx.nodeInput[field.name]
      const fallbackValue = rawValue ?? field.defaultValue

      if (field.required && !hasValue(fallbackValue))
        return { type: 'failed', error: `输入字段 ${field.name} 为必填` }

      if (!hasValue(fallbackValue)) {
        normalizedInput[field.name] = fallbackValue
        continue
      }

      if (field.type === 'number') {
        const parsed = typeof fallbackValue === 'number' ? fallbackValue : Number(fallbackValue)
        if (Number.isNaN(parsed))
          return { type: 'failed', error: `输入字段 ${field.name} 需要 number` }
        normalizedInput[field.name] = parsed
        continue
      }

      if (field.type === 'select' && field.options.length > 0) {
        const allowed = field.options.map((option) => {
          if (option && typeof option === 'object')
            return String((option as { value?: unknown }).value ?? '')
          return String(option ?? '')
        })
        if (!allowed.includes(String(fallbackValue)))
          return { type: 'failed', error: `输入字段 ${field.name} 不在可选项中` }
      }

      normalizedInput[field.name] = fallbackValue
    }

    return { type: 'success', output: normalizedInput }
  }
}

class CodeNodeExecutor implements NodeExecutor {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    const config = toObject(ctx.node.data.config)
    const code = typeof config.code === 'string' ? config.code : ''
    if (!code.trim())
      return { type: 'failed', error: '代码节点 code 为空' }

    try {
      const run = new Function('input', `${code}\n;return typeof main === 'function' ? main(input) : {}`)
      const result = run(ctx.variables)
      const output = toObject(result)
      const writebacks = buildNodeWritebacks(config.writebackMappings, output)
      return { type: 'success', output, writebacks }
    }
    catch (error) {
      return { type: 'failed', error: error instanceof Error ? error.message : '代码执行失败' }
    }
  }
}

class HttpNodeExecutor implements NodeExecutor {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    const config = toObject(ctx.node.data.config)
    const method = typeof config.method === 'string' ? config.method : 'GET'
    const timeout = typeof config.timeout === 'number' ? config.timeout : 30
    const urlTemplate = typeof config.url === 'string' ? config.url : ''
    const urlRendered = renderTemplateWithMissing(urlTemplate, ctx.variables)
    if (urlRendered.missing.length > 0)
      return { type: 'failed', error: `HTTP 节点参数未解析：${urlRendered.missing.join('，')}` }
    const url = urlRendered.rendered
    if (!url.trim())
      return { type: 'failed', error: 'HTTP 节点 URL 为空' }

    const headersList = Array.isArray(config.headers) ? config.headers : []
    const queryList = Array.isArray(config.query) ? config.query : []
    const bodyType = typeof config.bodyType === 'string' ? config.bodyType : 'none'
    const bodyTemplate = typeof config.body === 'string' ? config.body : ''

    const requestHeaders = new Headers()
    const missingKeys = new Set<string>()
    headersList.forEach((item) => {
      const key = typeof item?.key === 'string' ? item.key.trim() : ''
      const rendered = typeof item?.value === 'string' ? renderTemplateWithMissing(item.value, ctx.variables) : { rendered: '', missing: [] as string[] }
      rendered.missing.forEach(k => missingKeys.add(k))
      const value = rendered.rendered
      if (key)
        requestHeaders.set(key, value)
    })

    const authorization = toObject((config as any).authorization)
    const authType = typeof authorization.type === 'string' ? authorization.type.trim() : 'none'
    const authHeaderName = typeof authorization.header === 'string' && authorization.header.trim()
      ? authorization.header.trim()
      : 'Authorization'
    const rawAuthTemplate = typeof authorization.apiKey === 'string' ? authorization.apiKey : ''
    const authRendered = renderTemplateWithMissing(rawAuthTemplate, ctx.variables)
    authRendered.missing.forEach(k => missingKeys.add(k))
    const rawAuthValue = authRendered.rendered.trim()
    if (authType === 'bearer' && rawAuthValue) {
      const value = rawAuthValue.toLowerCase().startsWith('bearer ')
        ? rawAuthValue
        : `Bearer ${rawAuthValue}`
      requestHeaders.set(authHeaderName, value)
    }
    if (authType === 'api-key' && rawAuthValue) {
      requestHeaders.set(authHeaderName, rawAuthValue)
    }

    const query = new URLSearchParams()
    queryList.forEach((item) => {
      const key = typeof item?.key === 'string' ? item.key.trim() : ''
      const rendered = typeof item?.value === 'string' ? renderTemplateWithMissing(item.value, ctx.variables) : { rendered: '', missing: [] as string[] }
      rendered.missing.forEach(k => missingKeys.add(k))
      const value = rendered.rendered
      if (key)
        query.append(key, value)
    })

    let requestUrl = url
    const queryString = query.toString()
    if (queryString)
      requestUrl = requestUrl.includes('?') ? `${requestUrl}&${queryString}` : `${requestUrl}?${queryString}`

    let body: string | undefined
    if (bodyType !== 'none') {
      const rendered = renderTemplateWithMissing(bodyTemplate, ctx.variables)
      rendered.missing.forEach(k => missingKeys.add(k))
      body = rendered.rendered
      if (bodyType === 'json' && !requestHeaders.has('content-type'))
        requestHeaders.set('content-type', 'application/json')
    }

    if (missingKeys.size > 0)
      return { type: 'failed', error: `HTTP 节点参数未解析：${[...missingKeys].sort().join('，')}` }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.max(1000, timeout * 1000))
      const response = await fetch(requestUrl, {
        method,
        headers: requestHeaders,
        body: ['GET', 'HEAD'].includes(method) ? undefined : body,
        signal: controller.signal,
      })
      clearTimeout(timer)

      const rawText = await response.text()
      let parsedBody: unknown = rawText
      try {
        parsedBody = rawText ? JSON.parse(rawText) : null
      }
      catch {
      }
      const output = {
        status: response.status,
        ok: response.ok,
        body: parsedBody,
        raw: rawText,
      } satisfies Record<string, unknown>
      const writebacks = buildNodeWritebacks(config.writebackMappings, parsedBody)
      return { type: 'success', output, writebacks }
    }
    catch (error) {
      return {
        type: 'failed',
        error: error instanceof Error ? error.message : 'HTTP 请求失败',
      }
    }
  }
}

class IfElseNodeExecutor implements NodeExecutor {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    const config = toObject(ctx.node.data.config)
    const conditions = Array.isArray(config.conditions) ? config.conditions.map(item => toObject(item)) : []
    const elseBranchName = typeof config.elseBranchName === 'string' && config.elseBranchName.trim()
      ? config.elseBranchName
      : 'else'

    for (let index = 0; index < conditions.length; index += 1) {
      const condition = conditions[index]
      const left = resolveValue(condition.left, ctx.variables)
      const operator = typeof condition.operator === 'string' ? condition.operator : 'eq'
      const right = resolveValue(condition.right, ctx.variables)
      const matched = compareCondition(left, operator, right)
      if (!matched)
        continue

      const branchName = typeof condition.name === 'string' && condition.name.trim()
        ? condition.name
        : `分支${index + 1}`
      const handleId = buildIfElseBranchHandleId(index)
      return {
        type: 'branch',
        handleId,
        branchName,
        output: { branch: branchName, branchHandle: handleId },
      }
    }

    return {
      type: 'branch',
      handleId: IF_ELSE_FALLBACK_HANDLE,
      branchName: elseBranchName,
      output: { branch: elseBranchName, branchHandle: IF_ELSE_FALLBACK_HANDLE },
    }
  }
}

class PassthroughExecutor implements NodeExecutor {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    return { type: 'success', output: { ...ctx.variables, __nodeType: ctx.node.data.type } }
  }
}

class EndNodeExecutor implements NodeExecutor {
  async execute(ctx: NodeExecutorContext): Promise<NodeExecutorResult> {
    const config = toObject(ctx.node.data.config)
    const outputs = Array.isArray(config.outputs) ? config.outputs : []
    if (outputs.length === 0)
      return { type: 'success', output: { ...ctx.variables } }

    const resolved: Record<string, unknown> = {}
    outputs.forEach((item) => {
      const entry = toObject(item)
      const name = typeof entry.name === 'string' ? entry.name.trim() : ''
      if (!name)
        return
      const source = entry.source
      resolved[name] = resolveValue(source, ctx.variables)
    })

    if (Object.keys(resolved).length === 0)
      return { type: 'success', output: { ...ctx.variables } }

    return { type: 'success', output: resolved }
  }
}

export const createExecutorRegistry = () => {
  const start = new StartNodeExecutor()
  const input = new InputNodeExecutor()
  const code = new CodeNodeExecutor()
  const ifElse = new IfElseNodeExecutor()
  const http = new HttpNodeExecutor()
  const end = new EndNodeExecutor()
  const pass = new PassthroughExecutor()
  return {
    start,
    input,
    code,
    end,
    llm: pass,
    'if-else': ifElse,
    iteration: pass,
    'http-request': http,
    'api-request': pass,
  }
}
