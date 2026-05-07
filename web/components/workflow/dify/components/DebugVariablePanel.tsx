import { useEffect, useMemo, useState } from 'react'

type DebugVariablePanelProps = {
  open: boolean
  variables: Record<string, unknown>
  recentVariables: Record<string, unknown> | null
  onClose: () => void
  onChange: (variables: Record<string, unknown>) => void
  onFillFromRecent: () => void
  onClear: () => void
}

const renderJson = (value: unknown) => {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  }
  catch {
    return '{}'
  }
}

const filterNonEmptyValue = (value: unknown): unknown => {
  if (value === null || value === undefined)
    return undefined
  if (typeof value === 'string')
    return value === '' ? undefined : value
  if (Array.isArray(value)) {
    const filtered = value
      .map(item => filterNonEmptyValue(item))
      .filter(item => item !== undefined)
    return filtered.length > 0 ? filtered : undefined
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, filterNonEmptyValue(item)] as const)
      .filter(([, item]) => item !== undefined)
    if (entries.length === 0)
      return undefined
    return Object.fromEntries(entries)
  }
  return value
}

export default function DebugVariablePanel({
  open,
  variables,
  recentVariables,
  onClose,
  onChange,
  onFillFromRecent,
  onClear,
}: DebugVariablePanelProps) {
  const [draftText, setDraftText] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open)
      return
    setDraftText(renderJson(variables))
    setError('')
  }, [open, variables])

  const filteredPreviewObject = useMemo(() => {
    const filtered = filterNonEmptyValue(variables)
    if (!filtered || typeof filtered !== 'object' || Array.isArray(filtered))
      return {}
    return filtered as Record<string, unknown>
  }, [variables])
  const preview = useMemo(() => renderJson(filteredPreviewObject), [filteredPreviewObject])
  const hasPreviewValue = Object.keys(filteredPreviewObject).length > 0

  if (!open)
    return null

  return (
    <div className="w-[380px] rounded-[28px] border border-white/80 bg-white/90 p-3 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.5)] backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">调试参数</div>
        <button onClick={onClose} className="rounded border border-gray-300 px-2 py-1 text-xs">关闭</button>
      </div>
      <div className="mb-2 text-xs text-slate-500">仅用于“调试当前节点”的变量上下文（JSON 对象）。</div>
      <textarea
        className="h-52 w-full rounded border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-700"
        value={draftText}
        onChange={(event) => {
          const next = event.target.value
          setDraftText(next)
          try {
            const parsed = JSON.parse(next) as unknown
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              setError('必须是 JSON 对象')
              return
            }
            setError('')
            onChange(parsed as Record<string, unknown>)
          }
          catch (parseError) {
            setError(parseError instanceof Error ? parseError.message : 'JSON 解析失败')
          }
        }}
      />
      {!!error && <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={onFillFromRecent} disabled={!recentVariables} className="rounded border border-blue-300 bg-white px-2 py-1 text-xs text-blue-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400">从最近调试回填</button>
        <button type="button" onClick={onClear} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700">清空</button>
      </div>
      <div className="mt-3 text-xs text-slate-600">当前生效快照</div>
      {!hasPreviewValue && <div className="mt-1 rounded border border-gray-200 bg-gray-50 px-2 py-3 text-[11px] text-gray-500">当前无有效调试参数</div>}
      {hasPreviewValue && <pre className="mt-1 max-h-40 overflow-auto rounded border border-gray-200 bg-white p-2 text-[11px] text-gray-700">{preview}</pre>}
    </div>
  )
}
