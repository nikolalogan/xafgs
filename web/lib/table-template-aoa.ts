export type CellValue = string | number | null
export type TableAoa = CellValue[][]

const MISSING_VALUE = Symbol('missing-table-aoa-placeholder-value')

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

const toCellValue = (value: unknown): string | number | null => {
  if (typeof value === 'number' || typeof value === 'string')
    return value
  if (typeof value === 'boolean')
    return value ? 'true' : 'false'
  if (value === null)
    return null
  const serialized = JSON.stringify(value)
  return typeof serialized === 'string' ? serialized : ''
}

export const renderTableAoaPlaceholders = (templateAoa: TableAoa, context: Record<string, unknown>): TableAoa => {
  return templateAoa.map(row =>
    row.map((cell) => {
      if (typeof cell !== 'string')
        return cell
      return cell.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (fullMatch, rawPath: string) => {
        const resolved = resolvePath(context, rawPath)
        if (resolved === MISSING_VALUE)
          return fullMatch
        const value = toCellValue(resolved)
        return value === null ? '' : String(value)
      })
    }),
  )
}

export const parseTableAoaJson = (raw: string): TableAoa => {
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed))
    throw new Error('表格模板必须是二维数组 JSON')
  return parsed.map((row) => {
    if (!Array.isArray(row))
      throw new Error('表格模板必须是二维数组 JSON')
    return row.map((cell) => {
      if (typeof cell === 'string' || typeof cell === 'number' || cell === null)
        return cell
      return String(cell ?? '')
    })
  })
}
