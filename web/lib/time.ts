export const APP_TIME_ZONE = 'Asia/Shanghai'

export const formatShanghaiDateTime = (value?: string | number | Date) => {
  if (value === undefined || value === null || value === '')
    return '-'

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime()))
    return String(value)

  return date.toLocaleString('zh-CN', {
    timeZone: APP_TIME_ZONE,
    hourCycle: 'h23',
  })
}

export const formatShanghaiCompactTimestamp = (value: Date = new Date()) => {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)

  const byType = new Map(parts.map(part => [part.type, part.value]))
  return `${byType.get('year')}${byType.get('month')}${byType.get('day')}_${byType.get('hour')}${byType.get('minute')}${byType.get('second')}`
}

export const formatShanghaiFilenameTimestamp = (value: Date = new Date()) => {
  return formatShanghaiCompactTimestamp(value).replace('_', '-')
}
