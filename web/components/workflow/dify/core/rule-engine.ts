export type RuleSyntaxResult = {
  valid: boolean
  error?: string
}

export type CompiledRule = {
  code: string
  placeholders: string[]
  transformed: string
  execute?: (vars: Record<string, unknown>) => unknown
  syntaxError?: string
}

const PLACEHOLDER_REGEXP = /\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)\s*\}\}/g
const compiledRuleCache = new Map<string, CompiledRule>()

export const extractRulePlaceholders = (code: string): string[] => {
  const matches = [...code.matchAll(PLACEHOLDER_REGEXP)]
  const keys = matches.map(item => `${item[1]}.${item[2]}`)
  return [...new Set(keys)]
}

const transformRuleCode = (code: string) => {
  return code.replace(PLACEHOLDER_REGEXP, (_full, node, param) => `__vars["${node}.${param}"]`)
}

export const compileRule = (code: string): CompiledRule => {
  const cacheKey = code
  const cached = compiledRuleCache.get(cacheKey)
  if (cached)
    return cached

  const placeholders = extractRulePlaceholders(code)
  const transformed = transformRuleCode(code)
  let compiled: CompiledRule

  try {
    // eslint-disable-next-line no-new-func
    const execute = new Function('__vars', `"use strict";\n${transformed}`) as (vars: Record<string, unknown>) => unknown
    compiled = {
      code,
      placeholders,
      transformed,
      execute,
    }
  }
  catch (error) {
    compiled = {
      code,
      placeholders,
      transformed,
      syntaxError: error instanceof Error ? error.message : '语法错误',
    }
  }

  compiledRuleCache.set(cacheKey, compiled)
  return compiled
}

export const checkRuleSyntax = (code: string): RuleSyntaxResult => {
  if (!code.trim())
    return { valid: false, error: '规则代码不能为空。' }

  const compiled = compileRule(code)
  return compiled.syntaxError
    ? { valid: false, error: compiled.syntaxError }
    : { valid: true }
}

const parseInputValue = (raw: string): unknown => {
  const trimmed = raw.trim()
  if (trimmed === '')
    return ''
  if (trimmed === 'true')
    return true
  if (trimmed === 'false')
    return false
  if (!Number.isNaN(Number(trimmed)) && trimmed !== '')
    return Number(trimmed)
  try {
    return JSON.parse(trimmed)
  }
  catch {
    return raw
  }
}

export const runRule = (
  code: string,
  rawInputs: Record<string, string>,
): { ok: boolean; result?: boolean; error?: string } => {
  const compiled = compileRule(code)
  if (compiled.syntaxError)
    return { ok: false, error: compiled.syntaxError }
  const vars: Record<string, unknown> = {}
  Object.entries(rawInputs).forEach(([key, value]) => {
    vars[key] = parseInputValue(value)
  })

  return runCompiledRule(compiled, vars)
}

export const runCompiledRule = (
  compiled: CompiledRule,
  vars: Record<string, unknown>,
): { ok: boolean; result?: boolean; error?: string } => {
  if (compiled.syntaxError)
    return { ok: false, error: compiled.syntaxError }
  if (!compiled.execute)
    return { ok: false, error: '规则未成功编译' }

  try {
    const output = compiled.execute(vars)
    return {
      ok: true,
      result: Boolean(output),
    }
  }
  catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '执行失败',
    }
  }
}
