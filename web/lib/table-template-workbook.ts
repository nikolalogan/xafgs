export type TemplateWorkbookContent = {
  version: 1
  workbook: Record<string, unknown>
}

type ParseOk = { ok: true, value: TemplateWorkbookContent }
type ParseFail = { ok: false, error: string }

const PLACEHOLDER_REGEX = /\{\{\s*([^{}]+?)\s*\}\}/g
const MISSING_VALUE = Symbol('missing-workbook-placeholder-value')

export const createDefaultWorkbook = (): Record<string, unknown> => ({
  id: 'sheet-template',
  name: 'Sheet1',
  appVersion: '1.0.0',
  locale: 'zhCN',
  styles: {},
  sheetOrder: ['sheet-1'],
  sheets: {
    'sheet-1': {
      id: 'sheet-1',
      name: 'Sheet1',
      cellData: {
        '0': {
          cells: {
            '0': { v: '请在此输入模板内容，例如：{{user.name}}' },
          },
        },
      },
      rowCount: 50,
      columnCount: 26,
      zoomRatio: 1,
    },
  },
})

export const createDefaultTemplateWorkbookContent = (): TemplateWorkbookContent => ({
  version: 1,
  workbook: createDefaultWorkbook(),
})

export const serializeTemplateWorkbookContent = (content: TemplateWorkbookContent): string => {
  return JSON.stringify(content)
}

export const parseTemplateWorkbookContent = (raw: unknown): ParseOk | ParseFail => {
  const text = String(raw ?? '').trim()
  if (!text)
    return { ok: false, error: 'table content 为空，无法解析为 Univer Workbook JSON' }
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { ok: false, error: 'table content 必须是 JSON object' }
    const record = parsed as Record<string, unknown>
    if (record.version !== 1)
      return { ok: false, error: 'table content 版本不支持（仅支持 version=1）' }
    if (!record.workbook || typeof record.workbook !== 'object' || Array.isArray(record.workbook))
      return { ok: false, error: 'table content.workbook 必须是 JSON object' }
    return {
      ok: true,
      value: {
        version: 1,
        workbook: record.workbook as Record<string, unknown>,
      },
    }
  }
  catch {
    return { ok: false, error: 'table content 不是合法 JSON' }
  }
}

const resolvePath = (data: Record<string, unknown>, path: string): unknown => {
  const normalizedPath = String(path || '').trim()
  if (!normalizedPath)
    return MISSING_VALUE
  const segments = normalizedPath.split('.')
  let current: unknown = data
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment))
        return MISSING_VALUE
      const index = Number(segment)
      if (index < 0 || index >= current.length)
        return MISSING_VALUE
      current = current[index]
      continue
    }
    if (!current || typeof current !== 'object')
      return MISSING_VALUE
    const record = current as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, segment))
      return MISSING_VALUE
    current = record[segment]
  }
  if (typeof current === 'undefined')
    return MISSING_VALUE
  return current
}

const toStringValue = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (value === null)
    return ''
  const serialized = JSON.stringify(value)
  return typeof serialized === 'string' ? serialized : ''
}

const replacePlaceholdersInText = (input: string, context: Record<string, unknown>): string => {
  return input.replace(PLACEHOLDER_REGEX, (fullMatch, rawPath: string) => {
    const resolved = resolvePath(context, rawPath)
    if (resolved === MISSING_VALUE)
      return fullMatch
    return toStringValue(resolved)
  })
}

const walkAndReplace = (node: unknown, context: Record<string, unknown>): unknown => {
  if (Array.isArray(node))
    return node.map(item => walkAndReplace(item, context))
  if (!node || typeof node !== 'object')
    return node
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'v' && typeof value === 'string') {
      result[key] = replacePlaceholdersInText(value, context)
      continue
    }
    if (key === 'f' && typeof value === 'string') {
      const formulaText = value.startsWith('=') ? value.slice(1) : value
      result[key] = replacePlaceholdersInText(formulaText, context)
      continue
    }
    result[key] = walkAndReplace(value, context)
  }
  return result
}

export const renderWorkbookPlaceholders = (
  workbook: Record<string, unknown>,
  context: Record<string, unknown>,
): Record<string, unknown> => {
  return walkAndReplace(workbook, context) as Record<string, unknown>
}
