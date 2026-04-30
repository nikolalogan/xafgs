import { useState } from 'react'
import { Select } from 'antd'
import { validateParameterJsonDefault } from '../core/json-schema'
import type { WorkflowObjectType, WorkflowParameter } from '../core/types'

type WorkflowParamsPanelProps = {
  open: boolean
  params: WorkflowParameter[]
  objectTypes?: WorkflowObjectType[]
  onChangeObjectTypes?: (objectTypes: WorkflowObjectType[]) => void
  onClose: () => void
  onChange: (params: WorkflowParameter[]) => void
}

export default function WorkflowParamsPanel({
  open,
  params,
  objectTypes = [],
  onChangeObjectTypes,
  onClose,
  onChange,
}: WorkflowParamsPanelProps) {
  const [tips, setTips] = useState<Record<number, { ok: boolean; text: string }>>({})

  if (!open)
    return null

  const updateItem = (index: number, patch: Partial<WorkflowParameter>) => {
    const next = [...params]
    next[index] = { ...next[index], ...patch }
    onChange(next)
  }
  const updateObjectType = (index: number, patch: Partial<WorkflowObjectType>) => {
    if (!onChangeObjectTypes)
      return
    const next = [...objectTypes]
    next[index] = { ...next[index], ...patch }
    onChangeObjectTypes(next)
  }

  return (
    <div className="w-[380px] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">流程参数</div>
        <button onClick={onClose} className="rounded border border-gray-300 px-2 py-1 text-xs">关闭</button>
      </div>
      <div className="mb-3 text-xs text-gray-500">配置流程级输入参数，可在节点中引用。</div>
      <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
        <div className="space-y-2 rounded border border-emerald-200 bg-emerald-50/40 p-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-emerald-900">固定结构对象类型</div>
            <button
              type="button"
              className="rounded bg-white px-2 py-1 text-xs text-emerald-700"
              onClick={() => onChangeObjectTypes?.([...objectTypes, { id: '', name: '', description: '', schemaJson: '{\n  \"type\": \"object\",\n  \"properties\": {}\n}', sampleJson: '{}' }])}
            >
              新增对象类型
            </button>
          </div>
          <div className="text-xs text-emerald-700">`schemaJson` 是唯一结构真源；参数和开始节点可通过 `objectTypeId` 复用。</div>
          {objectTypes.map((item, index) => (
            <div key={`object-type-${index}`} className="space-y-2 rounded border border-emerald-200 bg-white p-2">
              <div className="grid grid-cols-2 gap-2">
                <input className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="ID" value={item.id} onChange={event => updateObjectType(index, { id: event.target.value })} />
                <input className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="名称" value={item.name} onChange={event => updateObjectType(index, { name: event.target.value })} />
              </div>
              <input className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" placeholder="描述" value={item.description} onChange={event => updateObjectType(index, { description: event.target.value })} />
              <textarea className="h-28 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono" placeholder="schemaJson" value={item.schemaJson} onChange={event => updateObjectType(index, { schemaJson: event.target.value })} />
              <textarea className="h-20 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono" placeholder="sampleJson（可选）" value={item.sampleJson ?? ''} onChange={event => updateObjectType(index, { sampleJson: event.target.value })} />
              <button type="button" className="rounded bg-red-50 px-2 py-1 text-xs text-red-600" onClick={() => onChangeObjectTypes?.(objectTypes.filter((_, idx) => idx !== index))}>删除对象类型</button>
            </div>
          ))}
        </div>
        {params.map((item, index) => (
          <div key={`workflow-param-${index}`} className="space-y-2 rounded border border-gray-200 p-2">
            <input
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              placeholder="参数名"
              value={item.name ?? ''}
              onChange={event => updateItem(index, { name: event.target.value })}
            />
            <input
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              placeholder="显示名"
              value={item.label ?? ''}
              onChange={event => updateItem(index, { label: event.target.value })}
            />
            <div className="flex items-center gap-2">
              <Select
                className="w-full"
                value={item.valueType}
                options={[
                  { value: 'string', label: 'string' },
                  { value: 'number', label: 'number' },
                  { value: 'boolean', label: 'boolean' },
                  { value: 'array', label: 'array' },
                  { value: 'object', label: 'object' },
                ]}
                onChange={(nextValue) => {
                  const nextType = nextValue as WorkflowParameter['valueType']
                  updateItem(index, {
                    valueType: nextType,
                    defaultValue: nextType === 'array' ? '[]' : nextType === 'object' ? '{}' : item.defaultValue,
                  })
                }}
              />
            </div>
            {(item.valueType === 'array' || item.valueType === 'object')
              ? (
                  <div className="space-y-2 rounded border border-gray-200 p-2">
                    <label className="block text-xs text-gray-500">默认值（JSON）</label>
                    <textarea
                      className="h-20 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
                      placeholder={item.valueType === 'array' ? '[]' : '{}'}
                      value={item.defaultValue}
                      onChange={event => updateItem(index, { defaultValue: event.target.value })}
                    />
                    {item.valueType === 'object' && (
                      <>
                        <label className="block text-xs text-gray-500">对象类型（推荐）</label>
                        <Select
                          className="w-full"
                          value={item.objectTypeId || undefined}
                          placeholder="选择对象类型"
                          allowClear
                          options={objectTypes.map(objectType => ({ value: objectType.id, label: `${objectType.name} (${objectType.id})` }))}
                          onChange={value => updateItem(index, { objectTypeId: value || undefined })}
                        />
                        <label className="block text-xs text-gray-500">结构（JSON，可选）</label>
                        <textarea
                          className="h-28 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
                          placeholder='{\n  "name": "示例"\n}'
                          value={item.json ?? ''}
                          onChange={event => updateItem(index, { json: event.target.value })}
                        />
                      </>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700"
                        onClick={() => {
                          const jsonType = item.valueType as 'array' | 'object'
                          const result = validateParameterJsonDefault(jsonType, item.defaultValue, item.json)
                          setTips(prev => ({
                            ...prev,
                            [index]: {
                              ok: result.valid,
                              text: result.valid ? '默认值通过 JSON 校验' : result.error,
                            },
                          }))
                        }}
                      >
                        校验 JSON
                      </button>
                    </div>
                    {tips[index] && (
                      <div className={`text-xs ${tips[index].ok ? 'text-green-600' : 'text-red-600'}`}>
                        {tips[index].text}
                      </div>
                    )}
                  </div>
                )
              : (
            <input
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              placeholder="默认值"
              value={item.defaultValue ?? ''}
              onChange={event => updateItem(index, { defaultValue: event.target.value })}
            />
                )}
            <input
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              placeholder="描述"
              value={item.description ?? ''}
              onChange={event => updateItem(index, { description: event.target.value })}
            />
            <button
              onClick={() => onChange(params.filter((_, idx) => idx !== index))}
              className="rounded bg-red-50 px-2 py-1 text-xs text-red-600"
            >
              删除参数
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => onChange([...params, {
          name: '',
          label: '',
          valueType: 'string',
          required: false,
          defaultValue: '',
          json: '',
          description: '',
        }])}
        className="mt-2 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
      >
        新增流程参数
      </button>
    </div>
  )
}
