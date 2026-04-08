export type CodeSyntaxResult = {
  valid: boolean
  error?: string
}

const templateRegexp = /\{\{\s*([^{}]+?)\s*\}\}/g

const parseInputValue = (raw: string): { ok: true; value: unknown } | { ok: false; error: string } => {
  const trimmed = String(raw || '').trim()
  if (!trimmed)
    return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'JSON 解析失败' }
  }
}

const normalizeTemplatePath = (value: string) => String(value || '').trim()

const getByPath = (source: unknown, rawPath: string): unknown => {
  const path = normalizeTemplatePath(rawPath)
  if (!path)
    return undefined
  const keys = path.split('.').map(item => item.trim()).filter(Boolean)
  let current = source
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

const hasTemplateValue = (value: unknown) => {
  if (value === null || value === undefined)
    return false
  if (typeof value === 'string')
    return value.trim().length > 0
  if (Array.isArray(value))
    return value.length > 0
  return true
}

const encodePythonLiteral = (value: unknown): string => {
  if (value === null || value === undefined)
    return 'None'
  if (typeof value === 'boolean')
    return value ? 'True' : 'False'
  if (typeof value === 'number')
    return JSON.stringify(value)
  if (typeof value === 'string')
    return JSON.stringify(value)
  if (Array.isArray(value))
    return `[${value.map(item => encodePythonLiteral(item)).join(', ')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}: ${encodePythonLiteral(item)}`)
    return `{${entries.join(', ')}}`
  }
  return JSON.stringify(value)
}

const encodeCodeLiteral = (value: unknown, language: 'javascript' | 'python3') => {
  if (language === 'python3')
    return encodePythonLiteral(value)
  return JSON.stringify(value)
}

const prepareCodeForExecution = (
  code: string,
  language: 'javascript' | 'python3',
  context: unknown,
  strictMissing = true,
): { ok: true; code: string } | { ok: false; error: string } => {
  const missing = new Set<string>()
  const rendered = String(code || '').replace(templateRegexp, (_full, rawPath: string) => {
    const path = normalizeTemplatePath(rawPath)
    if (!path)
      return 'null'
    const resolved = getByPath(context, path)
    if (!hasTemplateValue(resolved)) {
      if (strictMissing)
        missing.add(path)
      return 'null'
    }
    return encodeCodeLiteral(resolved, language)
  })

  if (missing.size > 0)
    return { ok: false, error: `代码节点参数未解析：${[...missing].sort().join('，')}` }

  return { ok: true, code: rendered }
}

export const checkCodeSyntax = (
  code: string,
  language: 'javascript' | 'python3',
): CodeSyntaxResult => {
  if (!String(code || '').trim())
    return { valid: false, error: '代码不能为空。' }

  if (language === 'python3')
    return { valid: true }

  try {
    const prepared = prepareCodeForExecution(code, language, {}, false)
    if (!prepared.ok)
      return { valid: false, error: prepared.error }
    // eslint-disable-next-line no-new-func
    new Function('"use strict";\n' + prepared.code)
    return { valid: true }
  }
  catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : '语法错误',
    }
  }
}

export const runCodeTest = (
  code: string,
  language: 'javascript' | 'python3',
  rawInput: string,
): { ok: boolean; output?: unknown; error?: string } => {
  const syntax = checkCodeSyntax(code, language)
  if (!syntax.valid)
    return { ok: false, error: syntax.error || '语法错误' }

  if (language === 'python3')
    return { ok: false, error: 'Python3 本地测试暂不支持，请保存后在运行页面执行。' }

  const parsed = parseInputValue(rawInput)
  if (!parsed.ok)
    return { ok: false, error: `输入 JSON 非法：${parsed.error}` }

  try {
    const prepared = prepareCodeForExecution(code, language, parsed.value)
    if (!prepared.ok)
      return { ok: false, error: prepared.error }
    // eslint-disable-next-line no-new-func
    const fn = new Function('input', `"use strict";\n${prepared.code}\n; return (typeof main === 'function') ? main(input) : ({})`) as (input: unknown) => unknown
    const output = fn(parsed.value)
    return { ok: true, output }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '执行失败' }
  }
}
