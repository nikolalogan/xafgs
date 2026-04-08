import { useEffect, useState } from 'react'
import { runCodeTest } from '../core/code-test-engine'

type CodeTestModalProps = {
  open: boolean
  title: string
  code: string
  language: 'javascript' | 'python3'
  onClose: () => void
}

const stringifyOutput = (value: unknown) => {
  if (value === undefined)
    return 'undefined'
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

export default function CodeTestModal({
  open,
  title,
  code,
  language,
  onClose,
}: CodeTestModalProps) {
  const [inputJSON, setInputJSON] = useState('{\n  "start": {\n    "city": "杭州"\n  }\n}')
  const [runResult, setRunResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [showCode, setShowCode] = useState(false)

  useEffect(() => {
    if (!open)
      return
    setRunResult(null)
    setShowCode(false)
  }, [open, code, language])

  if (!open)
    return null

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700" onClick={onClose}>关闭</button>
        </div>
        <div className="space-y-2">
          <div className="rounded border border-gray-200 p-2">
            <button
              type="button"
              className="text-xs text-blue-700 hover:text-blue-800"
              onClick={() => setShowCode(prev => !prev)}
            >
              {showCode ? '收起代码预览' : '展开代码预览'}
            </button>
            {showCode && (
              <pre className="mt-2 max-h-40 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-700 whitespace-pre-wrap">
                {code}
              </pre>
            )}
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-gray-500">测试输入（JSON，会作为 <code>{'{{xxx}}'}</code> 模板变量上下文）</label>
            <textarea
              className="h-32 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
              value={inputJSON}
              onChange={event => setInputJSON(event.target.value)}
              placeholder='{"start":{"city":"杭州"}}'
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
              onClick={() => {
                const result = runCodeTest(code, language, inputJSON)
                if (!result.ok) {
                  setRunResult({ ok: false, text: result.error || '执行失败' })
                  return
                }
                setRunResult({ ok: true, text: stringifyOutput(result.output) })
              }}
            >
              运行测试
            </button>
          </div>
          {runResult && (
            <div className="space-y-1">
              <div className={`text-xs ${runResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                {runResult.ok ? '测试通过' : '测试失败'}
              </div>
              <pre className={`max-h-56 overflow-auto rounded border p-2 text-xs whitespace-pre-wrap ${runResult.ok ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
                {runResult.text}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
