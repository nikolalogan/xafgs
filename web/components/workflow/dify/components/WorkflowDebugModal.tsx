'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DifyNode, DifyWorkflowDSL, WorkflowParameter } from '../core/types'
import type { DynamicField } from '../core/dynamic-form-rules'
import { BlockEnum } from '../core/types'
import WorkflowDynamicForm, { computeDynamicFormState, validateDynamicFormValues } from './WorkflowDynamicForm'

type RuntimeNodeStatus = 'pending' | 'running' | 'waiting_input' | 'succeeded' | 'failed' | 'skipped'

type DebugSession = {
  id: string
  workflowId: number
  targetNodeId: string
  status: 'ready' | 'waiting_input' | 'target_succeeded' | 'failed'
  variables: Record<string, unknown>
  nodeStates: Record<string, { nodeId: string, status: RuntimeNodeStatus, error?: string }>
  workflowParametersSnapshot: WorkflowParameter[]
  waitingInput?: {
    nodeId: string
    nodeTitle: string
    schema: {
      fields?: Array<{
        name: string
        label: string
        type: 'text' | 'paragraph' | 'number' | 'select' | 'checkbox'
        required?: boolean
        options?: Array<{ label: string, value: string }>
        defaultValue?: unknown
        visibleWhen?: string
        validateWhen?: string
      }>
    }
  }
  lastTargetInput?: Record<string, unknown>
  lastTargetOutput?: Record<string, unknown>
  lastWritebacks?: Array<{ targetPath: string, value: unknown }>
  error?: string
  updatedAt: string
}

type WorkflowDebugModalProps = {
  open: boolean
  workflowId?: number
  workflowDsl?: DifyWorkflowDSL | null
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

const normalizeFields = (raw: unknown): DynamicField[] => {
  if (!Array.isArray(raw))
    return []
  return raw.map((item) => {
    const entry = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    const normalizeOptions = (options: unknown) => {
      if (!Array.isArray(options))
        return []
      return options.map((option) => {
        if (typeof option === 'string')
          return { label: option, value: option }
        if (typeof option === 'object' && option !== null) {
          const value = typeof option.value === 'string' ? option.value : String(option.value ?? '')
          const label = typeof option.label === 'string' ? option.label : value
          return { label, value }
        }
        const value = String(option ?? '')
        return { label: value, value }
      }).filter(option => option.value)
    }
    return {
      name: typeof entry.name === 'string' ? entry.name : '',
      label: typeof entry.label === 'string' ? entry.label : '',
      type: entry.type === 'paragraph' ? 'paragraph' : entry.type === 'number' ? 'number' : entry.type === 'select' ? 'select' : entry.type === 'checkbox' ? 'checkbox' : 'text',
      required: Boolean(entry.required),
      options: normalizeOptions(entry.options),
      defaultValue: entry.defaultValue,
      visibleWhen: typeof entry.visibleWhen === 'string' ? entry.visibleWhen : undefined,
      validateWhen: typeof entry.validateWhen === 'string' ? entry.validateWhen : undefined,
    } satisfies DynamicField
  }).filter(field => field.name)
}

const readWorkflowValue = (variables: Record<string, unknown>, name: string) => {
  const workflow = typeof variables.workflow === 'object' && variables.workflow !== null
    ? variables.workflow as Record<string, unknown>
    : {}
  return workflow[name]
}

const statusTextMap: Record<DebugSession['status'], string> = {
  ready: '可继续调试',
  waiting_input: '等待前序输入',
  target_succeeded: '目标节点执行成功',
  failed: '调试失败',
}

export default function WorkflowDebugModal({
  open,
  workflowId,
  workflowDsl,
  targetNode,
  onClose,
}: WorkflowDebugModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState<DebugSession | null>(null)
  const [startInputValues, setStartInputValues] = useState<Record<string, unknown>>({})
  const [waitingInputValues, setWaitingInputValues] = useState<Record<string, unknown>>({})
  const autoCreateKeyRef = useRef('')

  const request = useCallback(async (url: string, payload?: unknown) => {
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
    const json = await response.json().catch(() => ({})) as { data?: DebugSession, message?: string, error?: string }
    if (!response.ok)
      throw new Error(json.message || json.error || `请求失败（HTTP ${response.status}）`)
    return json.data ?? null
  }, [])

  useEffect(() => {
    if (!open) {
      setLoading(false)
      setError('')
      setSession(null)
      setStartInputValues({})
      setWaitingInputValues({})
      autoCreateKeyRef.current = ''
    }
  }, [open])

  const startFields = useMemo(() => {
    const startNode = workflowDsl?.nodes?.find(node => String(node.data.type).toLowerCase() === BlockEnum.Start)
    const config = typeof startNode?.data?.config === 'object' && startNode.data.config !== null
      ? startNode.data.config as Record<string, unknown>
      : {}
    return normalizeFields(config.variables)
  }, [workflowDsl])

  const waitingFields = useMemo(() => normalizeFields(session?.waitingInput?.schema?.fields), [session?.waitingInput?.schema?.fields])

  const startDynamicFormState = useMemo(() => {
    return computeDynamicFormState(
      'start',
      startFields,
      startInputValues,
      session?.variables ?? {},
    )
  }, [session?.variables, startFields, startInputValues])

  const waitingDynamicFormState = useMemo(() => {
    if (!session?.waitingInput?.nodeId) {
      return {
        fieldStates: [],
        validateErrors: new Map<string, string | null>(),
      }
    }
    return computeDynamicFormState(
      session.waitingInput.nodeId,
      waitingFields,
      waitingInputValues,
      session.variables ?? {},
    )
  }, [session?.variables, session?.waitingInput?.nodeId, waitingFields, waitingInputValues])

  const submitCreate = useCallback(async () => {
    if (!workflowId || !workflowDsl || !targetNode) {
      setError('当前草稿 DSL 或目标节点缺失，无法创建调试会话。')
      return
    }
    const validated = validateDynamicFormValues(startFields, startInputValues, startDynamicFormState.fieldStates, startDynamicFormState.validateErrors)
    if (!validated.ok) {
      setError(validated.message)
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await request('/api/workflow/debug-sessions', {
        workflowId,
        workflowDsl,
        targetNodeId: targetNode.id,
        input: validated.normalized,
      })
      setSession(data)
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '创建调试会话失败')
    }
    finally {
      setLoading(false)
    }
  }, [request, startDynamicFormState.fieldStates, startDynamicFormState.validateErrors, startFields, startInputValues, targetNode, workflowDsl, workflowId])

  const continueSession = useCallback(async () => {
    if (!session?.waitingInput)
      return
    const validated = validateDynamicFormValues(waitingFields, waitingInputValues, waitingDynamicFormState.fieldStates, waitingDynamicFormState.validateErrors)
    if (!validated.ok) {
      setError(validated.message)
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await request(`/api/workflow/debug-sessions/${session.id}/continue`, {
        nodeId: session.waitingInput.nodeId,
        input: validated.normalized,
      })
      setSession(data)
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '继续调试失败')
    }
    finally {
      setLoading(false)
    }
  }, [request, session, waitingDynamicFormState.fieldStates, waitingDynamicFormState.validateErrors, waitingFields, waitingInputValues])

  const rerunTarget = useCallback(async () => {
    if (!session)
      return
    setLoading(true)
    setError('')
    try {
      const data = await request(`/api/workflow/debug-sessions/${session.id}/rerun-target`, {})
      setSession(data)
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '重跑目标节点失败')
    }
    finally {
      setLoading(false)
    }
  }, [request, session])

  const rebuildSession = useCallback(async () => {
    if (!session)
      return
    const validated = validateDynamicFormValues(startFields, startInputValues, startDynamicFormState.fieldStates, startDynamicFormState.validateErrors)
    if (!validated.ok) {
      setError(validated.message)
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await request(`/api/workflow/debug-sessions/${session.id}/rebuild`, {
        input: validated.normalized,
      })
      setSession(data)
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '重建调试会话失败')
    }
    finally {
      setLoading(false)
    }
  }, [request, session, startDynamicFormState.fieldStates, startDynamicFormState.validateErrors, startFields, startInputValues])

  useEffect(() => {
    if (!open || !targetNode || !workflowDsl || startFields.length > 0 || session)
      return
    const key = `${workflowId ?? 0}:${targetNode.id}`
    if (autoCreateKeyRef.current === key)
      return
    autoCreateKeyRef.current = key
    void submitCreate()
  }, [open, session, startFields.length, submitCreate, targetNode, workflowDsl, workflowId])

  useEffect(() => {
    if (!session?.waitingInput?.nodeId) {
      setWaitingInputValues({})
      return
    }
    setWaitingInputValues({})
  }, [session?.waitingInput?.nodeId])

  if (!open || !targetNode)
    return null

  const modal = (
    <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/40 p-4">
      <div className="h-[92vh] w-[94vw] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">草稿态节点调试</div>
            <div className="text-xs text-gray-500">{targetNode.data.title} · {targetNode.id}</div>
            <div className="text-xs text-gray-400">当前会话只基于草稿 DSL 补跑目标节点依赖链，不生成正式 execution，也不会回写草稿 DSL。</div>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100">关闭</button>
        </div>

        <div className="grid h-[calc(92vh-64px)] grid-cols-12 gap-3 p-3">
          <div className="col-span-4 space-y-3 overflow-auto rounded-xl border border-gray-200 p-3">
            <section className="space-y-3 rounded border border-blue-200 bg-blue-50 p-3">
              <div>
                <div className="text-xs font-semibold text-blue-800">从开始补跑到目标节点</div>
                <div className="mt-1 text-xs text-blue-700">首次调试会从 `start` 出发，只执行目标节点依赖链；之后重跑当前节点会复用已成功的前序缓存。</div>
              </div>
              <WorkflowDynamicForm fieldStates={startDynamicFormState.fieldStates} values={startInputValues} onChange={setStartInputValues} disabled={loading} />
              <div className="flex flex-wrap gap-2">
                {!session && (
                  <button type="button" disabled={loading} onClick={() => void submitCreate()} className="rounded bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800 disabled:bg-gray-300">
                    创建调试会话并补跑到目标
                  </button>
                )}
                {session && (
                  <button type="button" disabled={loading} onClick={() => void rebuildSession()} className="rounded border border-blue-300 bg-white px-3 py-2 text-xs text-blue-800 hover:bg-blue-100 disabled:bg-gray-100 disabled:text-gray-400">
                    从开始重新调试
                  </button>
                )}
                {session && (
                  <button type="button" disabled={loading || !!session.waitingInput} onClick={() => void rerunTarget()} className="rounded bg-amber-600 px-3 py-2 text-xs text-white hover:bg-amber-700 disabled:bg-gray-300">
                    重跑当前节点
                  </button>
                )}
              </div>
              {session && (
                <div className="rounded border border-blue-200 bg-white px-3 py-2 text-xs text-gray-700">
                  <div>调试状态：{statusTextMap[session.status]}</div>
                  <div>更新时间：{session.updatedAt}</div>
                </div>
              )}
            </section>

            <section className="space-y-2 rounded border border-gray-200 p-3">
              <div className="text-xs font-semibold text-gray-700">流程参数快照</div>
              {!session && <div className="text-xs text-gray-500">创建调试会话后展示当前草稿上下文中的流程参数值。</div>}
              {session && session.workflowParametersSnapshot.length === 0 && <div className="text-xs text-gray-500">当前流程未定义流程参数。</div>}
              {session && session.workflowParametersSnapshot.length > 0 && (
                <div className="space-y-2">
                  {session.workflowParametersSnapshot.map(item => (
                    <div key={item.name} className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                      <div className="font-medium text-gray-900">{item.label || item.name}</div>
                      <div className="mt-1 text-[11px] text-gray-500">参数名：{item.name} · 类型：{item.valueType || 'string'}</div>
                      <pre className="mt-2 overflow-auto rounded bg-white p-2 text-[11px] text-gray-700">{renderJson(readWorkflowValue(session.variables ?? {}, item.name))}</pre>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {session?.waitingInput && (
              <section className="space-y-2 rounded border border-blue-200 bg-blue-50 p-3">
                <div className="text-xs font-semibold text-blue-800">等待前序输入：{session.waitingInput.nodeTitle}</div>
                <WorkflowDynamicForm fieldStates={waitingDynamicFormState.fieldStates} values={waitingInputValues} onChange={setWaitingInputValues} disabled={loading} />
                <button type="button" disabled={loading} onClick={() => void continueSession()} className="rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700 disabled:bg-gray-300">
                  继续推进到目标节点
                </button>
              </section>
            )}

            {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
            {session?.error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{session.error}</div>}
          </div>

          <div className="col-span-8 grid grid-cols-2 gap-3 overflow-auto">
            <section className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">依赖链节点状态</div>
              <pre className="max-h-[32vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(session?.nodeStates ?? {})}</pre>
            </section>
            <section className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">调试变量快照</div>
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
              <div className="mb-2 text-xs font-semibold text-gray-700">实际 Writeback 结果</div>
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
