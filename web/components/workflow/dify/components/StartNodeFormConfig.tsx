import { useState } from 'react'
import { Select } from 'antd'
import RuleTestModal from './RuleTestModal'
import StartFormPreviewModal from './StartFormPreviewModal'
import AICodeGenerateModal from './AICodeGenerateModal'
import VariableValueInput from './VariableValueInput'
import type { AICodeGenerateTargetType } from '../core/ai-code-generate'
import { checkRuleSyntax } from '../core/rule-engine'
import type { VariableScope, WorkflowVariableOption } from '../core/variables'
import type { StartNodeConfig, WorkflowObjectType } from '../core/types'

type StartNodeFormConfigProps = {
  nodeId: string
  config: StartNodeConfig
  onChange: (nextConfig: StartNodeConfig) => void
  objectTypes?: WorkflowObjectType[]
  title?: string
  addButtonLabel?: string
  allowedTypes?: StartNodeConfig['variables'][number]['type'][]
  sectionKey?: string
  variableOptions: WorkflowVariableOption[]
  getScope: (fieldKey: string, fallback?: VariableScope) => VariableScope
  onScopeChange: (fieldKey: string, scope: VariableScope) => void
  modelOptions: Array<{ name: string; label: string }>
  defaultModel: string
}

const inputClass = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'
const labelClass = 'block text-xs text-gray-500'

export default function StartNodeFormConfig({
  nodeId,
  config,
  onChange,
  objectTypes = [],
  title = '开始节点参数',
  addButtonLabel = '新增参数',
  allowedTypes,
  sectionKey = 'start',
  variableOptions,
  getScope,
  onScopeChange,
  modelOptions,
  defaultModel,
}: StartNodeFormConfigProps) {
  const [optionalExpanded, setOptionalExpanded] = useState<Record<string, boolean>>({})
  const [ruleTestState, setRuleTestState] = useState<{ open: boolean; title: string; code: string }>({
    open: false,
    title: '',
    code: '',
  })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [aiModalState, setAIModalState] = useState<{
    open: boolean
    index: number
    targetType: AICodeGenerateTargetType
  }>({
    open: false,
    index: -1,
    targetType: 'visibleWhen',
  })

  const typeOptions: Array<{ value: StartNodeConfig['variables'][number]['type']; label: string }> = [
    { value: 'text-input', label: '单行文本' },
    { value: 'paragraph', label: '段落文本' },
    { value: 'select', label: '下拉选项' },
    { value: 'number', label: '数字' },
    { value: 'checkbox', label: '复选框' },
    { value: 'file', label: '单文件' },
    { value: 'file-list', label: '多文件' },
    { value: 'json_object', label: 'JSON 对象' },
  ]
  const visibleTypeOptions = allowedTypes
    ? typeOptions.filter(option => allowedTypes.includes(option.value))
    : typeOptions
  const defaultAddType = visibleTypeOptions[0]?.value ?? 'text-input'

  const updateVariable = (index: number, patch: Partial<StartNodeConfig['variables'][number]>) => {
    const next = [...config.variables]
    next[index] = { ...next[index], ...patch }
    onChange({ ...config, variables: next })
  }

  const defaultVisibleWhen = (index: number, name?: string) => {
    const param = (name || `field_${index + 1}`).trim() || `field_${index + 1}`
    return `const current = {{${nodeId}.${param}}}\nreturn true`
  }
  const defaultValidateWhen = (index: number, name?: string) => {
    const param = (name || `field_${index + 1}`).trim() || `field_${index + 1}`
    return `const current = {{${nodeId}.${param}}}\nreturn current !== undefined && current !== null && String(current).trim() !== ''`
  }

  return (
    <div className="space-y-2 rounded border border-gray-200 p-2">
      <div className="text-xs font-semibold text-gray-700">{title}</div>
      {config.variables.map((item, index) => {
        const expandedKey = `${nodeId}-${sectionKey}-${index}`
        const visibleCode = item.visibleWhen ?? defaultVisibleWhen(index, item.name)
        const validateCode = item.validateWhen ?? defaultValidateWhen(index, item.name)
        const visibleSyntax = checkRuleSyntax(visibleCode)
        const validateSyntax = checkRuleSyntax(validateCode)

        return (
          <div key={`param-${index}`} className="space-y-1 rounded border border-gray-200 p-2">
            <input
              className={inputClass}
              value={item.name}
              placeholder="参数名"
              onChange={event => updateVariable(index, { name: event.target.value })}
            />
            <input
              className={inputClass}
              value={item.label}
              placeholder="展示名"
              onChange={event => updateVariable(index, { label: event.target.value })}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="w-[124px]"
                value={item.type}
                options={visibleTypeOptions}
                onChange={(nextType) => {
                  updateVariable(index, {
                    type: nextType,
                    placeholder: undefined,
                    defaultValue: nextType === 'checkbox' ? false : undefined,
                    min: undefined,
                    max: undefined,
                    step: undefined,
                    maxLength: undefined,
                    options: nextType === 'select' ? (item.options ?? []) : undefined,
                    multiSelect: nextType === 'select' ? (item.multiSelect ?? false) : undefined,
                    fileTypes: (nextType === 'file' || nextType === 'file-list') ? (item.fileTypes ?? []) : undefined,
                    maxFiles: nextType === 'file-list' ? (item.maxFiles ?? 5) : undefined,
                    jsonSchema: nextType === 'json_object' ? (item.jsonSchema ?? '') : undefined,
                  })
                }}
              />
              <label className="flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" checked={item.required} onChange={event => updateVariable(index, { required: event.target.checked })} />
                必填
              </label>
              <button
                type="button"
                className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                onClick={() => setOptionalExpanded(prev => ({ ...prev, [expandedKey]: !prev[expandedKey] }))}
              >
                {optionalExpanded[expandedKey] ? '收起' : '展开'}
              </button>
              <button
                type="button"
                className="rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                onClick={() => onChange({ ...config, variables: config.variables.filter((_, i) => i !== index) })}
              >
                删除
              </button>
            </div>

            {optionalExpanded[expandedKey] && (
              <>
                {(item.type === 'text-input' || item.type === 'paragraph') && (
                  <>
                    <input className={inputClass} placeholder="占位提示（可选）" value={String(item.placeholder ?? '')} onChange={event => updateVariable(index, { placeholder: event.target.value })} />
                    <input className={inputClass} type="number" min="1" placeholder="最大长度（可选）" value={item.maxLength ?? ''} onChange={event => updateVariable(index, { maxLength: event.target.value ? Number(event.target.value) : undefined })} />
                    <input className={inputClass} placeholder="默认值（可选）" value={String(item.defaultValue ?? '')} onChange={event => updateVariable(index, { defaultValue: event.target.value })} />
                  </>
                )}

                {item.type === 'number' && (
                  <div className="grid grid-cols-12 gap-2">
                    <input className={`${inputClass} col-span-3`} type="number" placeholder="最小值" value={item.min ?? ''} onChange={event => updateVariable(index, { min: event.target.value ? Number(event.target.value) : undefined })} />
                    <input className={`${inputClass} col-span-3`} type="number" placeholder="最大值" value={item.max ?? ''} onChange={event => updateVariable(index, { max: event.target.value ? Number(event.target.value) : undefined })} />
                    <input className={`${inputClass} col-span-3`} type="number" placeholder="步长" value={item.step ?? ''} onChange={event => updateVariable(index, { step: event.target.value ? Number(event.target.value) : undefined })} />
                    <input className={`${inputClass} col-span-3`} type="number" placeholder="默认值" value={typeof item.defaultValue === 'number' ? item.defaultValue : ''} onChange={event => updateVariable(index, { defaultValue: event.target.value ? Number(event.target.value) : undefined })} />
                  </div>
                )}

                {item.type === 'checkbox' && (
                  <div className="space-y-1">
                    <label className={labelClass}>默认值</label>
                    <Select
                      className="w-full"
                      value={Boolean(item.defaultValue) ? 'checked' : 'unchecked'}
                      options={[
                        { value: 'checked', label: '默认勾选' },
                        { value: 'unchecked', label: '不默认勾选' },
                      ]}
                      onChange={value => updateVariable(index, { defaultValue: value === 'checked' })}
                    />
                  </div>
                )}

                {item.type === 'select' && (
                  <div className="space-y-2 rounded border border-gray-200 p-2">
                    <label className="flex items-center gap-1 text-xs text-gray-600">
                      <input type="checkbox" checked={Boolean(item.multiSelect)} onChange={event => updateVariable(index, { multiSelect: event.target.checked, defaultValue: undefined })} />
                      可多选
                    </label>
                    <div className="text-xs font-semibold text-gray-700">下拉选项</div>
                    {(item.options ?? []).map((option, optionIndex) => (
                      <div key={`opt-${index}-${optionIndex}`} className="grid grid-cols-12 gap-2">
                        <input className={`${inputClass} col-span-5`} placeholder="名称（label）" value={option.label} onChange={event => {
                          const next = [...(item.options ?? [])]
                          next[optionIndex] = { ...option, label: event.target.value }
                          updateVariable(index, { options: next })
                        }} />
                        <input className={`${inputClass} col-span-5`} placeholder="编码（value）" value={option.value} onChange={event => {
                          const next = [...(item.options ?? [])]
                          next[optionIndex] = { ...option, value: event.target.value }
                          updateVariable(index, { options: next })
                        }} />
                        <button type="button" className="col-span-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600" onClick={() => {
                          const next = (item.options ?? []).filter((_, i) => i !== optionIndex)
                          updateVariable(index, { options: next })
                        }}>删除</button>
                      </div>
                    ))}
                    <button type="button" className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700" onClick={() => updateVariable(index, { options: [...(item.options ?? []), { label: '', value: '' }] })}>新增选项</button>
                    {(item.options ?? []).length > 0 && (
                      <div className="space-y-1">
                        <label className={labelClass}>默认值</label>
                        {!item.multiSelect && (
                          <Select
                            className="w-full"
                            value={typeof item.defaultValue === 'string' ? item.defaultValue : undefined}
                            placeholder="不设置默认值"
                            allowClear
                            options={(item.options ?? []).filter(option => option.value.trim()).map(option => ({
                              value: option.value,
                              label: option.label || option.value,
                            }))}
                            onChange={value => updateVariable(index, { defaultValue: value || undefined })}
                          />
                        )}
                        {item.multiSelect && (
                          <div className="space-y-1 rounded border border-gray-200 p-2">
                            {(item.options ?? []).filter(option => option.value.trim()).map((option, optionIndex) => {
                              const selected = typeof item.defaultValue === 'string'
                                ? item.defaultValue.split(',').map(v => v.trim()).filter(Boolean)
                                : []
                              return (
                                <label key={`mdef-${index}-${optionIndex}`} className="flex items-center gap-2 text-xs text-gray-700">
                                  <input type="checkbox" checked={selected.includes(option.value)} onChange={event => {
                                    const set = new Set(selected)
                                    if (event.target.checked) set.add(option.value)
                                    else set.delete(option.value)
                                    updateVariable(index, { defaultValue: [...set].join(',') || undefined })
                                  }} />
                                  {option.label || option.value}
                                </label>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {(item.type === 'file' || item.type === 'file-list') && (
                  <>
                    <input className={inputClass} placeholder="允许文件类型，逗号分隔（如 pdf,jpg,png）" value={(item.fileTypes ?? []).join(',')} onChange={event => updateVariable(index, { fileTypes: event.target.value.split(',').map(t => t.trim()).filter(Boolean) })} />
                    {item.type === 'file-list' && (
                      <input className={inputClass} type="number" min="1" placeholder="最大文件数" value={item.maxFiles ?? 5} onChange={event => updateVariable(index, { maxFiles: Number(event.target.value || 1) })} />
                    )}
                  </>
                )}

                {item.type === 'json_object' && (
                  <div className="space-y-2">
                    <Select
                      className="w-full"
                      value={item.objectTypeId || undefined}
                      placeholder="绑定对象类型（可选）"
                      allowClear
                      options={objectTypes.map(objectType => ({ value: objectType.id, label: `${objectType.name} (${objectType.id})` }))}
                      onChange={value => updateVariable(index, {
                        objectTypeId: value || undefined,
                        jsonSchema: value ? (objectTypes.find(item => item.id === value)?.schemaJson ?? item.jsonSchema) : item.jsonSchema,
                      })}
                    />
                    <textarea className="h-20 w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-mono" placeholder="JSON Schema（兼容旧配置，可选）" value={item.jsonSchema ?? ''} onChange={event => updateVariable(index, { jsonSchema: event.target.value })} />
                  </div>
                )}

                <VariableValueInput
                  label="是否可见（JS 返回 true/false）"
                  value={visibleCode}
                  onChange={nextValue => updateVariable(index, { visibleWhen: nextValue })}
                  options={variableOptions}
                  scope={getScope(`${nodeId}.${sectionKey}.${index}.visibleWhen`, 'all')}
                  onScopeChange={scope => onScopeChange(`${nodeId}.${sectionKey}.${index}.visibleWhen`, scope)}
                  allowMultiline
                  rows={3}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                    onClick={() => setAIModalState({ open: true, index, targetType: 'visibleWhen' })}
                  >
                    AI 生成
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${visibleSyntax.valid ? 'text-green-600' : 'text-red-600'}`}>
                    {visibleSyntax.valid ? '语法校验通过' : `语法错误：${visibleSyntax.error}`}
                  </span>
                  <button type="button" className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700" onClick={() => setRuleTestState({ open: true, title: `${item.label || item.name || `参数${index + 1}`} - 是否可见规则测试`, code: visibleCode })}>测试</button>
                </div>

                <VariableValueInput
                  label="结果校验（JS 返回 true/false）"
                  value={validateCode}
                  onChange={nextValue => updateVariable(index, { validateWhen: nextValue })}
                  options={variableOptions}
                  scope={getScope(`${nodeId}.${sectionKey}.${index}.validateWhen`, 'all')}
                  onScopeChange={scope => onScopeChange(`${nodeId}.${sectionKey}.${index}.validateWhen`, scope)}
                  allowMultiline
                  rows={4}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                    onClick={() => setAIModalState({ open: true, index, targetType: 'validateWhen' })}
                  >
                    AI 生成
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${validateSyntax.valid ? 'text-green-600' : 'text-red-600'}`}>
                    {validateSyntax.valid ? '语法校验通过' : `语法错误：${validateSyntax.error}`}
                  </span>
                  <button type="button" className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700" onClick={() => setRuleTestState({ open: true, title: `${item.label || item.name || `参数${index + 1}`} - 结果校验规则测试`, code: validateCode })}>测试</button>
                </div>
              </>
            )}
          </div>
        )
      })}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
          onClick={() => onChange({
            ...config,
            variables: [...config.variables, { name: '', label: '', type: defaultAddType, required: false }],
          })}
        >
          {addButtonLabel}
        </button>
        <button
          type="button"
          className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700"
          onClick={() => setPreviewOpen(true)}
        >
          预览表单
        </button>
      </div>

      <RuleTestModal
        open={ruleTestState.open}
        title={ruleTestState.title}
        code={ruleTestState.code}
        onClose={() => setRuleTestState(prev => ({ ...prev, open: false }))}
      />
      <StartFormPreviewModal
        open={previewOpen}
        nodeId={nodeId}
        title={title}
        config={config}
        onClose={() => setPreviewOpen(false)}
      />
      <AICodeGenerateModal
        open={aiModalState.open}
        context={(() => {
          if (!aiModalState.open)
            return null
          const target = config.variables[aiModalState.index]
          if (!target)
            return null
          const targetCode = aiModalState.targetType === 'visibleWhen'
            ? (target.visibleWhen ?? defaultVisibleWhen(aiModalState.index, target.name))
            : (target.validateWhen ?? defaultValidateWhen(aiModalState.index, target.name))
          const targetLabel = aiModalState.targetType === 'visibleWhen' ? '是否可见规则' : '结果校验规则'
          return {
            targetType: aiModalState.targetType,
            nodeType: sectionKey === 'input' ? 'input' : 'start',
            currentCode: targetCode,
            nodeId,
            fieldName: target.name || `field_${aiModalState.index + 1}`,
            title: `AI 生成${targetLabel}`,
          }
        })()}
        variableOptions={variableOptions}
        modelOptions={modelOptions}
        defaultModel={defaultModel}
        onClose={() => setAIModalState(prev => ({ ...prev, open: false }))}
        onConfirm={(generatedCode) => {
          const index = aiModalState.index
          if (index < 0 || index >= config.variables.length)
            return
          if (aiModalState.targetType === 'visibleWhen') {
            updateVariable(index, { visibleWhen: generatedCode })
            return
          }
          updateVariable(index, { validateWhen: generatedCode })
        }}
      />
    </div>
  )
}
