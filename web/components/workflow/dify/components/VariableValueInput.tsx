import { useMemo, useState } from 'react'
import { Select, TreeSelect } from 'antd'
import {
  buildWorkflowVariableTreeOptions,
  formatValueForDisplay,
  parseDisplayToRaw,
  type VariableScope,
  type WorkflowVariableOption,
} from '../core/variables'

type VariableValueInputProps = {
  label?: string
  value: string
  onChange: (nextValue: string) => void
  options: WorkflowVariableOption[]
  scope?: VariableScope
  onScopeChange?: (scope: VariableScope) => void
  allowMultiline?: boolean
  rows?: number
  placeholder?: string
}

const allScopes: Array<{ value: VariableScope; label: string }> = [
  { value: 'all', label: 'all' },
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'object', label: 'object' },
  { value: 'array', label: 'array' },
  { value: 'file', label: 'file' },
]

export default function VariableValueInput({
  label,
  value,
  onChange,
  options,
  scope,
  onScopeChange,
  allowMultiline = false,
  rows = 4,
  placeholder,
}: VariableValueInputProps) {
  const [selectedKey, setSelectedKey] = useState('')
  const activeScope = scope ?? 'all'

  const filteredOptions = useMemo(() => {
    if (activeScope === 'all')
      return options
    return options.filter(option => option.valueType === activeScope)
  }, [activeScope, options])
  const treeOptions = useMemo(
    () => buildWorkflowVariableTreeOptions(filteredOptions),
    [filteredOptions],
  )

  const displayValue = useMemo(
    () => formatValueForDisplay(value, options),
    [options, value],
  )

  const insertVariable = () => {
    const selected = filteredOptions.find(option => option.key === selectedKey)
    if (!selected)
      return
    onChange(`${value}${selected.placeholder}`)
  }

  const handleDisplayChange = (nextDisplayValue: string) => {
    onChange(parseDisplayToRaw(nextDisplayValue, options))
  }

  return (
    <div className="space-y-1">
      {label && <label className="block text-xs text-gray-500">{label}</label>}
      <div className="grid grid-cols-12 gap-2">
        <Select
          className="col-span-4 w-full"
          size="small"
          value={activeScope}
          options={allScopes}
          onChange={(nextValue) => onScopeChange?.(nextValue as VariableScope)}
        />
        <TreeSelect
          className="col-span-6 w-full"
          value={selectedKey || undefined}
          placeholder="选择参数"
          showSearch
          treeData={treeOptions}
          treeDefaultExpandAll
          popupMatchSelectWidth={false}
          filterTreeNode={(input, treeNode) => String(treeNode.title || '').toLowerCase().includes(input.toLowerCase())}
          onChange={value => setSelectedKey(String(value || ''))}
        />
        <button
          type="button"
          onClick={insertVariable}
          className="col-span-2 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
        >
          插入
        </button>
      </div>
      {allowMultiline
        ? (
            <textarea
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              rows={rows}
              value={displayValue}
              placeholder={placeholder}
              onChange={event => handleDisplayChange(event.target.value)}
            />
          )
        : (
            <input
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              value={displayValue}
              placeholder={placeholder}
              onChange={event => handleDisplayChange(event.target.value)}
            />
          )}
    </div>
  )
}
