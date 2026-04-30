'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DifyWorkflowDSL, DifyNode } from '../core/types'

type RuntimeNodeStatus = 'pending' | 'running' | 'waiting_input' | 'succeeded' | 'failed' | 'skipped'

type DebugSession = {
  id: string
  targetNodeId: string
  status: 'ready' | 'waiting_input' | 'target_succeeded' | 'failed'
  workflowDsl: DifyWorkflowDSL
  variables: Record<string, unknown>
  nodeStates: Record<string, { nodeId: string; status: RuntimeNodeStatus; error?: string }>
  waitingInput?: {
    nodeId: string
    nodeTitle: string
    schema: {
      fields?: Array<{
        name: string
        label: string
        type: 'text' | 'paragraph' | 'number' | 'select' | 'checkbox'
        required?: boolean
        options?: Array<{ label: string; value: string }>
        defaultValue?: unknown
      }>
    }
  }
  lastTargetInput?: Record<string, unknown>
  lastTargetOutput?: Record<string, unknown>
  lastWritebacks?: Array<{ targetPath: string; value: unknown }>
  error?: string
  updatedAt: string
}

type WorkflowDebugModalProps = {
  open: boolean
  workflowId?: number
  dsl: DifyWorkflowDSL
  targetNode: DifyNode | null
  onClose: () => void
}

const getToken = () => {
  if (typeof window === 'undefined')
    return ''
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const renderJson = (value: unknown) => {
  try {
    return JSON.stringify(value ?? null, null, 2)
  }
  catch {
    return String(value)
  }
}

export default function WorkflowDebugModal({ open, workflowId, dsl, targetNode, onClose }: WorkflowDebugModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [startInputText, setStartInputText] = useState('{}')
  const [session, setSession] = useState<DebugSession | null>(null)
  const [waitingInputValues, setWaitingInputValues] = useState<Record<string, unknown>>({})

  useEffect(() => {
    if (!open) {
      setLoading(false)
      setError('')
      setSession(null)
      setWaitingInputValues({})
    }
  }, [open])

  const waitingFields = useMemo(() => Array.isArray(session?.waitingInput?.schema?.fields) ? session?.waitingInput?.schema?.fields ?? [] : [], [session?.waitingInput?.schema?.fields])

  const request = async (url: string, payload?: unknown) => {
    const token = getToken()
    const response = await fetch(url, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    const json = await response.json().catch(() => ({})) as { data?: DebugSession; message?: string; error?: string }
    if (!response.ok)
      throw new Error(json.message || json.error || `请求失败（HTTP ${response.status}）`)
    return json.data
  }

  const createSession = async () => {
    if (!workflowId || !targetNode) {
      setError('当前工作流或目标节点缺失，无法创建调试会话。')
      return
    }
    setLoading(true)
    setError('')
    try {
      const parsed = JSON.parse(startInputText || '{}') as Record<string, unknown>
      const data = await request('/api/workflow/debug-sessions', {
        workflowId,
        workflowDsl: dsl,
        targetNodeId: targetNode.id,
        input: parsed,
      })
      setSession(data ?? null)
      setWaitingInputValues({})
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '创建调试会话失败')
    }
    finally {
      setLoading(false)
    }
  }

  const continueSession = async () => {
    if (!session?.waitingInput)
      return
    setLoading(true)
    setError('')
    try {
      const data = await request(`/api/workflow/debug-sessions/${session.id}/continue`, {
        nodeId: session.waitingInput.nodeId,
        input: waitingInputValues,
      })
      setSession(data ?? null)
      setWaitingInputValues({})
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '继续调试失败')
    }
    finally {
      setLoading(false)
    }
  }

  const rerunTarget = async () => {
    if (!session)
      return
    setLoading(true)
    setError('')
    try {
      const data = await request(`/api/workflow/debug-sessions/${session.id}/rerun-target`, {})
      setSession(data ?? null)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '重跑目标节点失败')
    }
    finally {
      setLoading(false)
    }
  }

  if (!open || !targetNode)
    return null

  const modal = (
    <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/40 p-4">
      <div className="h-[92vh] w-[94vw] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">节点调试</div>
            <div className="text-xs text-gray-500">{targetNode.data.title} · {targetNode.id}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100">关闭</button>
        </div>
        <div className="grid h-[calc(92vh-64px)] grid-cols-12 gap-3 p-3">
          <div className="col-span-4 space-y-3 overflow-auto rounded-xl border border-gray-200 p-3">
            <div>
              <div className="mb-1 text-xs font-semibold text-gray-700">开始输入（JSON）</div>
              <textarea className="h-40 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs" value={startInputText} onChange={event => setStartInputText(event.target.value)} />
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={loading} onClick={createSession} className="rounded bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800 disabled:bg-gray-300">{session ? '重建上下文后重跑' : '创建调试会话'}</button>
              <button type="button" disabled={loading || !session || !!session.waitingInput} onClick={rerunTarget} className="rounded bg-amber-600 px-3 py-2 text-xs text-white hover:bg-amber-700 disabled:bg-gray-300">重跑当前节点</button>
            </div>
            {session?.waitingInput && (
              <div className="space-y-2 rounded border border-blue-200 bg-blue-50 p-3">
                <div className="text-xs font-semibold text-blue-800">前序节点等待输入：{session.waitingInput.nodeTitle}</div>
                {waitingFields.map(field => (
                  <label key={field.name} className="block space-y-1 text-xs text-gray-700">
                    <span>{field.label || field.name}</span>
                    {field.type === 'paragraph'
                      ? <textarea className="h-20 w-full rounded border border-gray-300 px-2 py-1.5" value={String(waitingInputValues[field.name] ?? field.defaultValue ?? '')} onChange={event => setWaitingInputValues(prev => ({ ...prev, [field.name]: event.target.value }))} />
                      : field.type === 'checkbox'
                        ? <input type="checkbox" checked={Boolean(waitingInputValues[field.name] ?? field.defaultValue)} onChange={event => setWaitingInputValues(prev => ({ ...prev, [field.name]: event.target.checked }))} />
                        : <input className="w-full rounded border border-gray-300 px-2 py-1.5" type={field.type === 'number' ? 'number' : 'text'} value={String(waitingInputValues[field.name] ?? field.defaultValue ?? '')} onChange={event => setWaitingInputValues(prev => ({ ...prev, [field.name]: field.type === 'number' ? Number(event.target.value || 0) : event.target.value }))} />
                    }
                  </label>
                ))}
                <button type="button" disabled={loading} onClick={continueSession} className="rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700 disabled:bg-gray-300">继续推进到目标节点</button>
              </div>
            )}
            {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
            {session && (
              <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                <div>状态：{session.status}</div>
                <div>更新时间：{session.updatedAt}</div>
                {session.error && <div className="mt-1 text-rose-600">{session.error}</div>}
              </div>
            )}
          </div>
          <div className="col-span-8 grid grid-cols-2 gap-3 overflow-auto">
            <section className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">前序节点状态</div>
              <pre className="max-h-[32vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(session?.nodeStates ?? {})}</pre>
            </section>
            <section className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">会话变量快照</div>
              <pre className="max-h-[32vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(session?.variables ?? {})}</pre>
            </section>
            <section className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">当前节点输入上下文</div>
              <pre className="max-h-[32vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(session?.lastTargetInput ?? {})}</pre>
            </section>
            <section className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">当前节点输出</div>
              <pre className="max-h-[32vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(session?.lastTargetOutput ?? {})}</pre>
            </section>
            <section className="col-span-2 rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">Writeback 结果清单</div>
              <pre className="max-h-[22vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(session?.lastWritebacks ?? [])}</pre>
            </section>
          </div>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined')
    return modal
  return createPortal(modal, document.body)
}
