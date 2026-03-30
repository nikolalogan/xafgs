import { useEffect, useMemo, useState } from 'react'
import { runRule } from '../core/rule-engine'
import type { StartNodeConfig } from '../core/types'

type StartFormPreviewModalProps = {
  open: boolean
  nodeId: string
  title?: string
  config: StartNodeConfig
  onClose: () => void
}

const buildDefaultValue = (item: StartNodeConfig['variables'][number]) => {
  if (item.type === 'checkbox')
    return Boolean(item.defaultValue)
  if (item.type === 'number')
    return typeof item.defaultValue === 'number' ? item.defaultValue : ''
  if (item.type === 'select' && item.multiSelect) {
    if (typeof item.defaultValue === 'string')
      return item.defaultValue.split(',').map(v => v.trim()).filter(Boolean)
    return [] as string[]
  }
  if (item.defaultValue === undefined || item.defaultValue === null)
    return ''
  return String(item.defaultValue)
}

export default function StartFormPreviewModal({
  open,
  nodeId,
  title = '开始节点表单预览',
  config,
  onClose,
}: StartFormPreviewModalProps) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; text: string } | null>(null)

  const normalizedFields = useMemo(
    () => config.variables.filter(item => item.name.trim()),
    [config.variables],
  )

  useEffect(() => {
    if (!open)
      return
    setSubmitResult(null)
    setValues((prev) => {
      const next: Record<string, unknown> = {}
      normalizedFields.forEach((item) => {
        next[item.name] = prev[item.name] ?? buildDefaultValue(item)
      })
      return next
    })
  }, [normalizedFields, open])

  const toRuleRaw = (value: unknown): string => {
    if (value === null || value === undefined)
      return ''
    if (typeof value === 'string')
      return value
    if (typeof value === 'number' || typeof value === 'boolean')
      return String(value)
    try {
      return JSON.stringify(value)
    }
    catch {
      return ''
    }
  }

  const hasValue = (value: unknown) => {
    if (value === null || value === undefined)
      return false
    if (typeof value === 'string')
      return value.trim().length > 0
    if (Array.isArray(value))
      return value.length > 0
    return true
  }

  const ruleInputs = useMemo(() => {
    const next: Record<string, string> = {}
    normalizedFields.forEach((item) => {
      next[`${nodeId}.${item.name}`] = toRuleRaw(values[item.name])
    })
    return next
  }, [nodeId, normalizedFields, values])

  const fieldStates = useMemo(() => {
    return normalizedFields.map((item) => {
      let visible = true
      let visibleError: string | null = null
      if (item.visibleWhen && item.visibleWhen.trim()) {
        const visibleResult = runRule(item.visibleWhen, ruleInputs)
        if (visibleResult.ok)
          visible = Boolean(visibleResult.result)
        else
          visibleError = visibleResult.error ?? '可见规则执行失败'
      }

      let validateError: string | null = null
      if (visible && item.validateWhen && item.validateWhen.trim()) {
        const validateResult = runRule(item.validateWhen, ruleInputs)
        if (validateResult.ok) {
          if (!validateResult.result)
            validateError = '结果校验未通过'
        }
        else {
          validateError = validateResult.error ?? '结果校验执行失败'
        }
      }

      const requiredError = visible && item.required && !hasValue(values[item.name])
        ? '必填项不能为空'
        : null

      return {
        item,
        visible,
        visibleError,
        validateError,
        requiredError,
      }
    })
  }, [normalizedFields, ruleInputs, values])

  const visibleFieldStates = useMemo(
    () => fieldStates.filter(state => state.visible),
    [fieldStates],
  )

  if (!open)
    return null

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700" onClick={onClose}>关闭</button>
        </div>
        <div className="mb-2 flex items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
          <span>{`已显示 ${visibleFieldStates.length} / ${normalizedFields.length} 个字段（根据可见规则实时计算）`}</span>
          <button
            type="button"
            className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700"
            onClick={() => {
              const errors = visibleFieldStates.flatMap((state) => {
                const messages: string[] = []
                if (state.requiredError)
                  messages.push(`${state.item.label || state.item.name}: ${state.requiredError}`)
                if (state.validateError)
                  messages.push(`${state.item.label || state.item.name}: ${state.validateError}`)
                return messages
              })
              if (errors.length === 0) {
                setSubmitResult({ ok: true, text: '提交校验通过' })
                return
              }
              setSubmitResult({ ok: false, text: errors[0] })
            }}
          >
            提交预览校验
          </button>
        </div>
        {submitResult && (
          <div className={`mb-2 rounded border px-2 py-1.5 text-xs ${submitResult.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {submitResult.text}
          </div>
        )}
        <div className="max-h-[68vh] space-y-3 overflow-auto pr-1">
          {normalizedFields.length === 0 && (
            <div className="rounded border border-dashed border-gray-300 p-3 text-xs text-gray-500">
              暂无可预览字段，请先配置参数名。
            </div>
          )}
          {fieldStates.map(({ item, visible, visibleError, validateError, requiredError }, index) => (
            <div
              key={`${item.name}-${index}`}
              className={`space-y-1 rounded border p-2 ${visible ? 'border-gray-200' : 'border-dashed border-gray-300 bg-gray-50/70'}`}
            >
              <label className="block text-xs text-gray-600">
                {item.label || item.name}
                {item.required && <span className="ml-1 text-red-500">*</span>}
              </label>
              {!visible && (
                <div className="text-xs text-gray-500">当前字段被可见规则隐藏</div>
              )}
              {visible && (item.type === 'text-input' || item.type === 'paragraph') && (
                item.type === 'paragraph'
                  ? (
                      <textarea
                        className="h-20 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        placeholder={item.placeholder}
                        value={String(values[item.name] ?? '')}
                        onChange={event => setValues(prev => ({ ...prev, [item.name]: event.target.value }))}
                      />
                    )
                  : (
                      <input
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        placeholder={item.placeholder}
                        value={String(values[item.name] ?? '')}
                        onChange={event => setValues(prev => ({ ...prev, [item.name]: event.target.value }))}
                      />
                    )
              )}
              {visible && item.type === 'number' && (
                <input
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  type="number"
                  min={item.min}
                  max={item.max}
                  step={item.step}
                  value={(() => {
                    const current = values[item.name]
                    if (typeof current === 'number')
                      return current
                    if (typeof current === 'string' && current.trim())
                      return Number(current)
                    return ''
                  })()}
                  onChange={event => setValues(prev => ({ ...prev, [item.name]: event.target.value ? Number(event.target.value) : '' }))}
                />
              )}
              {visible && item.type === 'checkbox' && (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={Boolean(values[item.name])}
                    onChange={event => setValues(prev => ({ ...prev, [item.name]: event.target.checked }))}
                  />
                  {item.label || item.name}
                </label>
              )}
              {visible && item.type === 'select' && !item.multiSelect && (
                <select
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  value={String(values[item.name] ?? '')}
                  onChange={event => setValues(prev => ({ ...prev, [item.name]: event.target.value }))}
                >
                  <option value="">请选择</option>
                  {(item.options ?? []).map((option, optionIndex) => (
                    <option key={`${item.name}-${optionIndex}`} value={option.value}>{option.label || option.value}</option>
                  ))}
                </select>
              )}
              {visible && item.type === 'select' && item.multiSelect && (
                <div className="space-y-1 rounded border border-gray-200 p-2">
                  {(item.options ?? []).map((option, optionIndex) => {
                    const selected = Array.isArray(values[item.name]) ? values[item.name] as string[] : []
                    return (
                      <label key={`${item.name}-${optionIndex}`} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={selected.includes(option.value)}
                          onChange={(event) => {
                            const set = new Set(selected)
                            if (event.target.checked)
                              set.add(option.value)
                            else
                              set.delete(option.value)
                            setValues(prev => ({ ...prev, [item.name]: [...set] }))
                          }}
                        />
                        {option.label || option.value}
                      </label>
                    )
                  })}
                </div>
              )}
              {visible && item.type === 'file' && (
                <input className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" type="file" />
              )}
              {visible && item.type === 'file-list' && (
                <input className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" type="file" multiple />
              )}
              {visible && item.type === 'json_object' && (
                <textarea
                  className="h-24 w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-mono"
                  placeholder={`{\n  "key": "value"\n}`}
                  value={String(values[item.name] ?? '')}
                  onChange={event => setValues(prev => ({ ...prev, [item.name]: event.target.value }))}
                />
              )}
              {visibleError && (
                <div className="text-xs text-amber-600">{`可见规则错误：${visibleError}`}</div>
              )}
              {visible && requiredError && (
                <div className="text-xs text-red-600">{requiredError}</div>
              )}
              {visible && validateError && (
                <div className="text-xs text-red-600">{validateError}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
