'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DifyNode, DifyWorkflowDSL, WorkflowParameter } from '../core/types'
import { buildPreparedRule, getRuleValueByPath, type DynamicField } from '../core/dynamic-form-rules'
import { buildInitialFormValues } from '../core/runtime-template'
import WorkflowDynamicForm, { computeDynamicFormState, validateDynamicFormValues } from './WorkflowDynamicForm'
import { createExecutorRegistry } from '../../../../lib/workflow-runtime/executors'

type WorkflowDebugModalProps = {
  open: boolean
  workflowId?: number
  workflowDsl?: DifyWorkflowDSL | null
  targetNode: DifyNode | null
  debugVariables: Record<string, unknown>
  onUpdateDebugVariables: (variables: Record<string, unknown>) => void
  onSessionDebugVariables?: (variables: Record<string, unknown>) => void
  onDebugSuccess?: (nodeId: string) => void
  onClose: () => void
}

type ExecuteDebugNodeOnceResult = {
  nodeInput: Record<string, unknown>
  nodeOutput?: Record<string, unknown>
  writebacks?: Array<{ targetPath: string, value: unknown }>
  error?: string
  updatedDebugVariables: Record<string, unknown>
}

const LOCAL_EXEC_NODE_TYPES = new Set(['start', 'code', 'if-else'])
const RULE_ENGINE_VERSION = 'rule-v20260506-ctx'

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

const normalizePath = (path: string) => path
  .trim()
  .replace(/^\$\./, '')
  .replace(/^\$/, '')
  .replace(/\[(\d+)\]/g, '.$1')

const splitPath = (path: string) => normalizePath(path).split('.').map(item => item.trim()).filter(Boolean)

const setByPath = (target: Record<string, unknown>, rawPath: string, value: unknown) => {
  const keys = splitPath(rawPath)
  if (keys.length === 0)
    return

  let current: Record<string, unknown> = target
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index]
    const next = current[key]
    if (!next || typeof next !== 'object' || Array.isArray(next))
      current[key] = {}
    current = current[key] as Record<string, unknown>
  }
  current[keys[keys.length - 1]] = value
}

const applyWritebacks = (variables: Record<string, unknown>, writebacks: Array<{ targetPath: string, value: unknown }>) => {
  writebacks.forEach((mapping) => {
    const targetPath = String(mapping.targetPath || '').trim()
    if (!targetPath || targetPath === 'workflow' || targetPath === 'global' || targetPath === 'user')
      return

    if (targetPath.endsWith('[]') && Array.isArray(mapping.value)) {
      const appendPath = targetPath.replace(/\[\]$/, '').replace(/\.$/, '')
      const keys = splitPath(appendPath)
      if (keys.length === 0)
        return
      let current: Record<string, unknown> = variables
      for (let i = 0; i < keys.length - 1; i += 1) {
        const key = keys[i]
        const next = current[key]
        if (!next || typeof next !== 'object' || Array.isArray(next))
          current[key] = {}
        current = current[key] as Record<string, unknown>
      }
      const finalKey = keys[keys.length - 1]
      const existing = current[finalKey]
      const merged = Array.isArray(existing) ? [...existing, ...mapping.value] : mapping.value
      current[finalKey] = merged
      return
    }

    setByPath(variables, targetPath, mapping.value)
  })
}

const filterNonEmptyValue = (value: unknown): unknown => {
  if (value === null || value === undefined)
    return undefined
  if (typeof value === 'string')
    return value === '' ? undefined : value
  if (Array.isArray(value)) {
    const filtered = value.map(item => filterNonEmptyValue(item)).filter(item => item !== undefined)
    return filtered.length > 0 ? filtered : undefined
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, filterNonEmptyValue(item)] as const)
      .filter(([, item]) => item !== undefined)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }
  return value
}

const parseWorkflowParameterDefaultValue = (parameter: WorkflowParameter): unknown => {
  const rawDefault = String(parameter.defaultValue ?? '').trim()
  if (parameter.valueType === 'number') {
    const parsed = Number(rawDefault)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  if (parameter.valueType === 'boolean') {
    if (rawDefault === 'true')
      return true
    if (rawDefault === 'false')
      return false
    return undefined
  }
  if (parameter.valueType === 'array' || parameter.valueType === 'object') {
    if (rawDefault) {
      try {
        return JSON.parse(rawDefault)
      }
      catch {}
    }
    return parameter.valueType === 'array' ? [] : {}
  }
  return rawDefault
}

const buildRuntimeRuleVariables = (
  debugVariables: Record<string, unknown>,
  workflowDsl?: DifyWorkflowDSL | null,
) => {
  const base = JSON.parse(JSON.stringify(debugVariables ?? {})) as Record<string, unknown>
  if (!base.workflow || typeof base.workflow !== 'object' || Array.isArray(base.workflow))
    base.workflow = {}
  const workflowVars = base.workflow as Record<string, unknown>
  const parameters = Array.isArray(workflowDsl?.workflowParameters) ? workflowDsl.workflowParameters : []
  parameters.forEach((parameter) => {
    const name = String(parameter.name || '').trim()
    if (!name)
      return
    const keys = splitPath(name)
    if (keys.length === 1 && Object.prototype.hasOwnProperty.call(workflowVars, keys[0]))
      return
    setByPath(workflowVars, name, parseWorkflowParameterDefaultValue(parameter))
  })
  return base
}

const buildValidationDiagnosticMessage = (
  validationMessage: string,
  fieldStates: Array<{ item: DynamicField; visible: boolean }>,
  runtimeRuleVariables: Record<string, unknown>,
) => {
  const fallback = validationMessage || '输入校验失败'
  const matched = validationMessage.match(/^([^:：]+)\s*[:：]\s*(.+)$/)
  if (!matched)
    return fallback
  const label = matched[1].trim()
  const reason = matched[2].trim()
  const targetState = fieldStates.find(state => (state.item.label || state.item.name) === label || state.item.name === label)
  if (!targetState?.item?.validateWhen)
    return fallback
  const preparedRule = buildPreparedRule(targetState.item.validateWhen, '__debug__')
  if (!preparedRule || preparedRule.externalDeps.length === 0)
    return `${fallback}\n规则：${targetState.item.validateWhen}`

  const deps = preparedRule.externalDeps.map((dep) => {
    const value = getRuleValueByPath(runtimeRuleVariables, dep)
    return `${dep}=${JSON.stringify(value ?? null)}`
  }).join('；')
  return `${label}: ${reason}\n规则：${targetState.item.validateWhen}\n依赖：${deps}`
}

const buildApiRequestNodeInput = (
  targetNode: DifyNode | null,
  validatedNodeInput: Record<string, unknown>,
) => {
  if (targetNode?.data?.type !== 'api-request')
    return validatedNodeInput
  const config = targetNode.data.config && typeof targetNode.data.config === 'object'
    ? targetNode.data.config as Record<string, unknown>
    : {}
  const paramValues = Array.isArray(config.paramValues) ? config.paramValues : []
  const merged: Record<string, unknown> = {}
  paramValues.forEach((item) => {
    const entry = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    const location = typeof entry.in === 'string' ? entry.in.trim() : ''
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!location || !name)
      return
    merged[`${location}:${name}`] = entry.value
  })
  return { ...merged, ...validatedNodeInput }
}

export default function WorkflowDebugModal({
  open,
  workflowId,
  workflowDsl,
  targetNode,
  debugVariables,
  onUpdateDebugVariables,
  onSessionDebugVariables,
  onDebugSuccess,
  onClose,
}: WorkflowDebugModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [startInputValues, setStartInputValues] = useState<Record<string, unknown>>({})
  const [nodeInputValues, setNodeInputValues] = useState<Record<string, unknown>>({})
  const [result, setResult] = useState<ExecuteDebugNodeOnceResult | null>(null)

  const request = useCallback(async (payload: unknown) => {
    const token = getToken()
    const response = await fetch('/api/workflow/debug-node/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
    const json = await response.json().catch(() => ({})) as { data?: ExecuteDebugNodeOnceResult, message?: string, error?: string }
    if (!response.ok) {
      const detail = json.message || json.error || '请求失败'
      throw new Error(`${detail}（HTTP ${response.status}）`)
    }
    return json.data ?? null
  }, [])

  useEffect(() => {
    if (!open) {
      setLoading(false)
      setError('')
      setStartInputValues({})
      setNodeInputValues({})
      setResult(null)
    }
  }, [open])

  const startFields = useMemo(() => {
    const startNode = workflowDsl?.nodes?.find(node => node?.data?.type === 'start')
    const variables = startNode?.data?.config && typeof startNode.data.config === 'object'
      ? (startNode.data.config as Record<string, unknown>).variables
      : []
    return normalizeFields(Array.isArray(variables)
      ? variables.map((item) => {
          const entry = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
          const type = entry.type === 'text-input' ? 'text' : entry.type
          return { ...entry, type }
        })
      : [])
  }, [workflowDsl])

  const nodeInputFields = useMemo(() => {
    if (targetNode?.data?.type !== 'input')
      return []
    const config = targetNode.data.config && typeof targetNode.data.config === 'object'
      ? targetNode.data.config as Record<string, unknown>
      : {}
    return normalizeFields(config.fields)
  }, [targetNode])

  const runtimeRuleVariables = useMemo(
    () => buildRuntimeRuleVariables(debugVariables ?? {}, workflowDsl),
    [debugVariables, workflowDsl],
  )

  const startDynamicFormState = useMemo(() => {
    return computeDynamicFormState('start', startFields, startInputValues, runtimeRuleVariables)
  }, [runtimeRuleVariables, startFields, startInputValues])

  const nodeInputDynamicFormState = useMemo(() => {
    if (!targetNode)
      return { fieldStates: [], validateErrors: new Map<string, string | null>() }
    return computeDynamicFormState(targetNode.id, nodeInputFields, nodeInputValues, runtimeRuleVariables)
  }, [nodeInputFields, nodeInputValues, runtimeRuleVariables, targetNode])
  const isStartTarget = targetNode?.id === 'start' || targetNode?.data?.type === 'start'

  const executeLocal = useCallback(async (validatedStartInput: Record<string, unknown>, validatedNodeInput: Record<string, unknown>) => {
    if (!targetNode)
      throw new Error('目标节点不存在')
    const registry = createExecutorRegistry()
    const executor = registry[targetNode.data.type as keyof ReturnType<typeof createExecutorRegistry>]
    if (!executor)
      throw new Error(`不支持的节点类型：${targetNode.data.type}`)

    const baseVariables = JSON.parse(JSON.stringify(runtimeRuleVariables ?? {})) as Record<string, unknown>
    Object.entries(validatedStartInput).forEach(([key, value]) => {
      baseVariables[key] = value
    })
    const variables = baseVariables
    const runResult = await executor.execute({
      node: targetNode as never,
      variables,
      nodeInput: Object.keys(validatedNodeInput).length > 0 ? validatedNodeInput : undefined,
    })

    if (runResult.type === 'failed') {
      return {
        nodeInput: { variables, nodeInput: validatedNodeInput },
        error: runResult.error,
        updatedDebugVariables: variables,
      } satisfies ExecuteDebugNodeOnceResult
    }

    if (runResult.type === 'waiting_input') {
      return {
        nodeInput: { variables, nodeInput: validatedNodeInput },
        error: '当前节点需要输入参数',
        updatedDebugVariables: variables,
      } satisfies ExecuteDebugNodeOnceResult
    }

    const output = runResult.output ?? {}
    if (targetNode.id !== 'start')
      variables[targetNode.id] = output
    const writebacks = runResult.type === 'success' ? (runResult.writebacks ?? []) : []
    applyWritebacks(variables, writebacks)

    return {
      nodeInput: { variables, nodeInput: validatedNodeInput },
      nodeOutput: output,
      writebacks,
      updatedDebugVariables: variables,
    } satisfies ExecuteDebugNodeOnceResult
  }, [runtimeRuleVariables, targetNode])

  const executeCurrentNode = useCallback(async () => {
    if (!workflowId || !workflowDsl || !targetNode) {
      setError('当前草稿 DSL 或目标节点缺失，无法执行调试。')
      return
    }

    const normalizedStartInput: Record<string, unknown> = {}
    if (isStartTarget) {
      const validatedStart = validateDynamicFormValues(startFields, startInputValues, startDynamicFormState.fieldStates, startDynamicFormState.validateErrors)
      if (!validatedStart.ok) {
        setError(buildValidationDiagnosticMessage(validatedStart.message, startDynamicFormState.fieldStates, runtimeRuleVariables))
        return
      }
      Object.assign(normalizedStartInput, validatedStart.normalized)
    }

    const validatedNodeInput = validateDynamicFormValues(nodeInputFields, nodeInputValues, nodeInputDynamicFormState.fieldStates, nodeInputDynamicFormState.validateErrors)
    if (!validatedNodeInput.ok) {
      setError(buildValidationDiagnosticMessage(validatedNodeInput.message, nodeInputDynamicFormState.fieldStates, runtimeRuleVariables))
      return
    }
    const mergedNodeInput = buildApiRequestNodeInput(targetNode, validatedNodeInput.normalized)

    setLoading(true)
    setError('')
    try {
      const data = LOCAL_EXEC_NODE_TYPES.has(targetNode.data.type)
        ? await executeLocal(normalizedStartInput, mergedNodeInput)
        : await request({
            workflowId,
            workflowDsl,
            targetNodeId: targetNode.id,
            startInput: normalizedStartInput,
            debugVariables: runtimeRuleVariables,
            nodeInput: mergedNodeInput,
          })
      setResult(data)
      if (data)
        onDebugSuccess?.(targetNode.id)
      if (data?.updatedDebugVariables && typeof data.updatedDebugVariables === 'object' && !Array.isArray(data.updatedDebugVariables)) {
        onUpdateDebugVariables(data.updatedDebugVariables)
        onSessionDebugVariables?.(data.updatedDebugVariables)
      }
    }
    catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '执行当前节点失败')
    }
    finally {
      setLoading(false)
    }
  }, [executeLocal, isStartTarget, nodeInputDynamicFormState.fieldStates, nodeInputDynamicFormState.validateErrors, nodeInputFields, nodeInputValues, onDebugSuccess, onSessionDebugVariables, onUpdateDebugVariables, request, runtimeRuleVariables, startDynamicFormState.fieldStates, startDynamicFormState.validateErrors, startFields, startInputValues, targetNode, workflowDsl, workflowId])

  useEffect(() => {
    if (!open) {
      setStartInputValues({})
      setNodeInputValues({})
      return
    }
    setStartInputValues(buildInitialFormValues(startFields, runtimeRuleVariables))
    setNodeInputValues(buildInitialFormValues(nodeInputFields, runtimeRuleVariables))
  }, [nodeInputFields, open, runtimeRuleVariables, startFields, targetNode?.id, workflowId])

  if (!open || !targetNode)
    return null

  const filteredDebugVariables = filterNonEmptyValue(runtimeRuleVariables)
  const debugPreview = filteredDebugVariables && typeof filteredDebugVariables === 'object' ? filteredDebugVariables : {}

  const modal = (
    <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/40 p-4">
      <div className="h-[92vh] w-[94vw] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">草稿态节点调试</div>
            <div className="text-xs text-gray-500">{targetNode.data.title} · {targetNode.id}</div>
            <div className="text-xs text-gray-400">调试结果仅保存在前端临时内存，不创建调试会话。规则引擎：{RULE_ENGINE_VERSION}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100">关闭</button>
        </div>

        <div className="grid h-[calc(92vh-64px)] grid-cols-12 gap-3 p-3">
          <div className="col-span-4 space-y-3 overflow-auto rounded-xl border border-gray-200 p-3">
            <section className="space-y-3 rounded border border-blue-200 bg-blue-50 p-3">
              <div>
                <div className="text-xs font-semibold text-blue-800">单次执行当前节点</div>
                <div className="mt-1 text-xs text-blue-700">`input`/HTTP/LLM/API/迭代节点走后端同步接口；仅 `start`/`code`/`if-else` 保持本地执行。</div>
              </div>
              <button type="button" disabled={loading} onClick={() => void executeCurrentNode()} className="rounded bg-slate-900 px-3 py-2 text-xs text-white hover:bg-slate-800 disabled:bg-gray-300">
                {loading ? '执行中...' : '执行当前节点'}
              </button>
            </section>

            {isStartTarget && startFields.length > 0 && (
              <section className="space-y-2 rounded border border-gray-200 p-3">
                <div className="text-xs font-semibold text-gray-700">开始节点参数</div>
                <WorkflowDynamicForm fieldStates={startDynamicFormState.fieldStates} values={startInputValues} onChange={setStartInputValues} disabled={loading} />
              </section>
            )}

            {nodeInputFields.length > 0 && (
              <section className="space-y-2 rounded border border-gray-200 p-3">
                <div className="text-xs font-semibold text-gray-700">当前节点输入参数</div>
                <WorkflowDynamicForm fieldStates={nodeInputDynamicFormState.fieldStates} values={nodeInputValues} onChange={setNodeInputValues} disabled={loading} />
              </section>
            )}

            <section className="space-y-2 rounded border border-gray-200 p-3">
              <div className="text-xs font-semibold text-gray-700">调试参数快照（非空值）</div>
              <pre className="max-h-[26vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(debugPreview)}</pre>
            </section>
            <section className="space-y-2 rounded border border-gray-200 p-3">
              <div className="text-xs font-semibold text-gray-700">规则计算上下文（完整）</div>
              <pre className="max-h-[26vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(runtimeRuleVariables)}</pre>
            </section>

            {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
            {result?.error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{result.error}</div>}
          </div>

          <div className="col-span-8 grid grid-cols-2 gap-3 overflow-auto">
            <section className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">当前节点输入上下文</div>
              <pre className="max-h-[32vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(result?.nodeInput ?? {})}</pre>
            </section>
            <section className="rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">当前节点输出</div>
              <pre className="max-h-[32vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(result?.nodeOutput ?? {})}</pre>
            </section>
            <section className="col-span-2 rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">实际 Writeback 结果</div>
              <pre className="max-h-[22vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(result?.writebacks ?? [])}</pre>
            </section>
            <section className="col-span-2 rounded-xl border border-gray-200 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">执行后调试变量</div>
              <pre className="max-h-[28vh] overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">{renderJson(result?.updatedDebugVariables ?? {})}</pre>
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
