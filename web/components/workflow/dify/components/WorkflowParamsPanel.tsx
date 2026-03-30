import { useState } from 'react'
import { inferWorkflowParamFromSchema, validateParameterJsonDefault } from '../core/json-schema'
import type { WorkflowParameter } from '../core/types'

type WorkflowParamsPanelProps = {
  open: boolean
  params: WorkflowParameter[]
  onClose: () => void
  onChange: (params: WorkflowParameter[]) => void
}

export default function WorkflowParamsPanel({
  open,
  params,
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

  return (
    <div className="w-[380px] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">流程参数</div>
        <button onClick={onClose} className="rounded border border-gray-300 px-2 py-1 text-xs">关闭</button>
      </div>
      <div className="mb-3 text-xs text-gray-500">配置流程级输入参数，可在节点中引用。</div>
      <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
        {params.map((item, index) => (
          <div key={`workflow-param-${index}`} className="space-y-2 rounded border border-gray-200 p-2">
            <input
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              placeholder="参数名"
              value={item.name}
              onChange={event => updateItem(index, { name: event.target.value })}
            />
            <input
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              placeholder="显示名"
              value={item.label}
              onChange={event => updateItem(index, { label: event.target.value })}
            />
            <div className="flex items-center gap-2">
              <select
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={item.valueType}
                onChange={(event) => {
                  const nextType = event.target.value as WorkflowParameter['valueType']
                  updateItem(index, {
                    valueType: nextType,
                    defaultValue: nextType === 'array' ? '[]' : nextType === 'object' ? '{}' : item.defaultValue,
                  })
                }}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="array">array</option>
                <option value="object">object</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={item.required}
                  onChange={event => updateItem(index, { required: event.target.checked })}
                />
                必填
              </label>
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
                    <label className="block text-xs text-gray-500">JSON Schema</label>
                    <textarea
                      className="h-32 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
                      placeholder={item.valueType === 'array'
                        ? '{\n  "type": "array",\n  "items": { "type": "string" }\n}'
                        : '{\n  "type": "object",\n  "properties": {\n    "name": { "type": "string" }\n  }\n}'}
                      value={item.jsonSchema ?? ''}
                      onChange={event => updateItem(index, { jsonSchema: event.target.value })}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                        onClick={() => {
                          const infer = inferWorkflowParamFromSchema(item.jsonSchema ?? '')
                          if (!infer.ok) {
                            setTips(prev => ({ ...prev, [index]: { ok: false, text: `Schema 导入失败：${infer.error}` } }))
                            return
                          }
                          updateItem(index, {
                            ...infer.patch,
                            jsonSchema: item.jsonSchema ?? '',
                          })
                          setTips(prev => ({ ...prev, [index]: { ok: true, text: 'Schema 导入成功（已同步类型/标题/描述）' } }))
                        }}
                      >
                        从 Schema 导入
                      </button>
                      <button
                        type="button"
                        className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700"
                        onClick={() => {
                          const jsonType = item.valueType as 'array' | 'object'
                          const result = validateParameterJsonDefault(jsonType, item.defaultValue, item.jsonSchema)
                          setTips(prev => ({
                            ...prev,
                            [index]: {
                              ok: result.valid,
                              text: result.valid ? '默认值通过 JSON/Schema 校验' : result.error,
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
                    value={item.defaultValue}
                    onChange={event => updateItem(index, { defaultValue: event.target.value })}
                  />
                )}
            <input
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              placeholder="描述"
              value={item.description}
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
          jsonSchema: '',
          description: '',
        }])}
        className="mt-2 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
      >
        新增流程参数
      </button>
    </div>
  )
}
