import { useMemo, useState } from 'react'
import {
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
        <select
          className="col-span-4 rounded border border-gray-300 px-2 py-1.5 text-xs"
          value={activeScope}
          onChange={(event) => onScopeChange?.(event.target.value as VariableScope)}
        >
          {allScopes.map(item => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <select
          className="col-span-6 rounded border border-gray-300 px-2 py-1.5 text-xs"
          value={selectedKey}
          onChange={event => setSelectedKey(event.target.value)}
        >
          <option value="">选择参数</option>
          {filteredOptions.map(option => (
            <option key={option.key} value={option.key}>{option.displayLabel}</option>
          ))}
        </select>
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
