const MISSING_VALUE = Symbol('missing-table-placeholder-value')

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const toDisplayValue = (value: unknown) => {
  if (typeof value === 'string')
    return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (value === null)
    return 'null'
  const stringified = JSON.stringify(value)
  return typeof stringified === 'string' ? stringified : '#N/A'
}

export const resolvePath = (data: Record<string, unknown>, path: string): unknown => {
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

export const renderTablePlaceholders = (templateHtml: string, mappedContext: Record<string, unknown>) => {
  const source = String(templateHtml || '')
  return source.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, rawPath: string) => {
    const resolved = resolvePath(mappedContext, rawPath)
    if (resolved === MISSING_VALUE)
      return '#N/A'
    return escapeHtml(toDisplayValue(resolved))
  })
}
