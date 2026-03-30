import { useEffect, useMemo, useState } from 'react'
import { extractRulePlaceholders, runRule } from '../core/rule-engine'

type RuleTestModalProps = {
  open: boolean
  title: string
  code: string
  onClose: () => void
}

export default function RuleTestModal({
  open,
  title,
  code,
  onClose,
}: RuleTestModalProps) {
  const placeholders = useMemo(() => extractRulePlaceholders(code), [code])
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [runResult, setRunResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!open)
      return
    const nextInputs: Record<string, string> = {}
    placeholders.forEach((key) => {
      nextInputs[key] = inputs[key] ?? ''
    })
    setInputs(nextInputs)
    setRunResult(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, code])

  if (!open)
    return null

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700" onClick={onClose}>关闭</button>
        </div>
        <div className="space-y-2">
          <div className="rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-700 whitespace-pre-wrap">
            {code}
          </div>
          {placeholders.length === 0 && (
            <div className="text-xs text-gray-500">该规则未引用参数，可直接运行测试。</div>
          )}
          {placeholders.map(key => (
            <div key={key} className="space-y-1">
              <label className="block text-xs text-gray-500">{`参数 ${key}`}</label>
              <input
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={inputs[key] ?? ''}
                placeholder="输入测试值（支持 true/false、数字、JSON）"
                onChange={event => setInputs(prev => ({ ...prev, [key]: event.target.value }))}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
              onClick={() => {
                const result = runRule(code, inputs)
                if (!result.ok) {
                  setRunResult({ ok: false, text: result.error || '执行失败' })
                  return
                }
                setRunResult({ ok: true, text: `返回结果：${String(result.result)}` })
              }}
            >
              运行测试
            </button>
            {runResult && (
              <span className={`text-xs ${runResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                {runResult.text}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
