import { useMemo, useRef, useState } from 'react'
import AICodeGenerateModal from './AICodeGenerateModal'
import CodeTestModal from './CodeTestModal'
import type { AICodeGenerateNodeType } from '../core/ai-code-generate'
import { checkCodeSyntax } from '../core/code-test-engine'
import type { VariableScope, WorkflowVariableOption } from '../core/variables'

type CodeEditorAIGenerateConfig = {
  nodeType: AICodeGenerateNodeType
  language?: 'javascript' | 'python3'
  nodeId?: string
  fieldName?: string
  modelOptions: Array<{ name: string; label: string }>
  defaultModel: string
}

type CodeEditorFieldProps = {
  value: string
  onChange: (nextValue: string) => void
  options: WorkflowVariableOption[]
  scope: VariableScope
  onScopeChange: (scope: VariableScope) => void
  placeholder?: string
  className?: string
  showVariableInsert?: boolean
  aiGenerateConfig?: CodeEditorAIGenerateConfig
}

const scopeOptions: Array<{ value: VariableScope; label: string }> = [
  { value: 'all', label: 'all' },
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'object', label: 'object' },
  { value: 'array', label: 'array' },
  { value: 'file', label: 'file' },
]

export default function CodeEditorField({
  value,
  onChange,
  options,
  scope,
  onScopeChange,
  placeholder,
  className = 'h-40 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs',
  showVariableInsert = true,
  aiGenerateConfig,
}: CodeEditorFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [aiModalOpen, setAIModalOpen] = useState(false)
  const [testModalOpen, setTestModalOpen] = useState(false)

  const filteredOptions = useMemo(() => {
    if (scope === 'all')
      return options
    return options.filter(option => option.valueType === scope)
  }, [options, scope])
  const testLanguage = aiGenerateConfig?.language ?? 'javascript'
  const syntaxResult = useMemo(() => {
    if (aiGenerateConfig?.nodeType !== 'code')
      return null
    return checkCodeSyntax(value, testLanguage)
  }, [aiGenerateConfig?.nodeType, testLanguage, value])

  const insertVariable = () => {
    const selected = filteredOptions.find(option => option.key === selectedKey)
    if (!selected)
      return

    const token = selected.placeholder
    const textarea = textareaRef.current
    if (!textarea) {
      onChange(`${value}${token}`)
      return
    }

    const start = textarea.selectionStart ?? value.length
    const end = textarea.selectionEnd ?? value.length
    const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`
    onChange(nextValue)

    requestAnimationFrame(() => {
      textarea.focus()
      const caret = start + token.length
      textarea.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className="space-y-2">
      {showVariableInsert && (
        <div className="grid grid-cols-12 gap-2">
          <select
            className="col-span-4 rounded border border-gray-300 px-2 py-1.5 text-xs"
            value={scope}
            onChange={event => onScopeChange(event.target.value as VariableScope)}
          >
            {scopeOptions.map(item => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <select
            className="col-span-6 rounded border border-gray-300 px-2 py-1.5 text-xs"
            value={selectedKey}
            onChange={event => setSelectedKey(event.target.value)}
          >
            <option value="">选择参数（插入到代码）</option>
            {filteredOptions.map(option => (
              <option key={option.key} value={option.key}>{option.displayLabel}</option>
            ))}
          </select>
          <button
            type="button"
            className="col-span-2 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
            onClick={insertVariable}
          >
            插入
          </button>
        </div>
      )}
      {aiGenerateConfig && (
        <div className="flex items-center justify-between">
          {aiGenerateConfig.nodeType === 'code' ? (
            <button
              type="button"
              className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
              onClick={() => setTestModalOpen(true)}
            >
              测试
            </button>
          ) : <span />}
          <button
            type="button"
            className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
            onClick={() => setAIModalOpen(true)}
          >
            AI 生成
          </button>
        </div>
      )}
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
      />
      {aiGenerateConfig && (
        <>
          {syntaxResult && (
            <div className={`text-xs ${syntaxResult.valid ? 'text-green-600' : 'text-red-600'}`}>
              {syntaxResult.valid ? '语法校验通过' : `语法错误：${syntaxResult.error}`}
            </div>
          )}
        </>
      )}
      {aiGenerateConfig && (
        <AICodeGenerateModal
          open={aiModalOpen}
          context={{
            targetType: 'code',
            nodeType: aiGenerateConfig.nodeType,
            language: aiGenerateConfig.language,
            nodeId: aiGenerateConfig.nodeId,
            fieldName: aiGenerateConfig.fieldName,
            currentCode: value,
            title: 'AI 生成代码',
          }}
          variableOptions={options}
          modelOptions={aiGenerateConfig.modelOptions}
          defaultModel={aiGenerateConfig.defaultModel}
          onClose={() => setAIModalOpen(false)}
          onConfirm={generatedCode => onChange(generatedCode)}
        />
      )}
      {aiGenerateConfig?.nodeType === 'code' && (
        <CodeTestModal
          open={testModalOpen}
          title="代码测试"
          code={value}
          language={testLanguage}
          onClose={() => setTestModalOpen(false)}
        />
      )}
    </div>
  )
}
