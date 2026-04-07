export type CodeSyntaxResult = {
  valid: boolean
  error?: string
}

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

export const checkCodeSyntax = (
  code: string,
  language: 'javascript' | 'python3',
): CodeSyntaxResult => {
  if (!String(code || '').trim())
    return { valid: false, error: '代码不能为空。' }

  if (language === 'python3')
    return { valid: true }

  try {
    // eslint-disable-next-line no-new-func
    new Function('"use strict";\n' + String(code))
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
    // eslint-disable-next-line no-new-func
    const fn = new Function('input', `"use strict";\n${code}\n; return (typeof main === 'function') ? main(input) : ({})`) as (input: unknown) => unknown
    const output = fn(parsed.value)
    return { ok: true, output }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '执行失败' }
  }
}

