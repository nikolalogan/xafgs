export type RuleSyntaxResult = {
  valid: boolean
  error?: string
}

const PLACEHOLDER_REGEXP = /\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)\s*\}\}/g

export const extractRulePlaceholders = (code: string): string[] => {
  const matches = [...code.matchAll(PLACEHOLDER_REGEXP)]
  const keys = matches.map(item => `${item[1]}.${item[2]}`)
  return [...new Set(keys)]
}

const transformRuleCode = (code: string) => {
  return code.replace(PLACEHOLDER_REGEXP, (_full, node, param) => `__vars["${node}.${param}"]`)
}

export const checkRuleSyntax = (code: string): RuleSyntaxResult => {
  if (!code.trim())
    return { valid: false, error: '规则代码不能为空。' }

  try {
    const transformed = transformRuleCode(code)
    // eslint-disable-next-line no-new-func
    new Function('__vars', `"use strict";\n${transformed}`)
    return { valid: true }
  }
  catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : '语法错误',
    }
  }
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
  const syntax = checkRuleSyntax(code)
  if (!syntax.valid)
    return { ok: false, error: syntax.error }

  const vars: Record<string, unknown> = {}
  Object.entries(rawInputs).forEach(([key, value]) => {
    vars[key] = parseInputValue(value)
  })

  try {
    const transformed = transformRuleCode(code)
    // eslint-disable-next-line no-new-func
    const fn = new Function('__vars', `"use strict";\n${transformed}`) as (vars: Record<string, unknown>) => unknown
    const output = fn(vars)
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
