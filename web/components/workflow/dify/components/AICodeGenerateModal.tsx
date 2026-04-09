import { useEffect, useMemo, useState } from 'react'
import { Select, TreeSelect } from 'antd'
import { requestAICodeGenerate, type AICodeGenerateNodeType, type AICodeGenerateTargetType } from '../core/ai-code-generate'
import { buildWorkflowVariableTreeOptions, type WorkflowVariableOption } from '../core/variables'

type AICodeGenerateContext = {
  targetType: AICodeGenerateTargetType
  nodeType: AICodeGenerateNodeType
  language?: 'javascript' | 'python3'
  currentCode: string
  nodeId?: string
  fieldName?: string
  title?: string
}

type AICodeGenerateModalProps = {
  open: boolean
  context: AICodeGenerateContext | null
  variableOptions: WorkflowVariableOption[]
  modelOptions: Array<{ name: string; label: string }>
  defaultModel: string
  onClose: () => void
  onConfirm: (generatedCode: string) => void
}

const getTargetLabel = (targetType: AICodeGenerateTargetType) => {
  if (targetType === 'visibleWhen')
    return '是否可见规则'
  if (targetType === 'validateWhen')
    return '结果校验规则'
  return '代码执行逻辑'
}

export default function AICodeGenerateModal({
  open,
  context,
  variableOptions,
  modelOptions,
  defaultModel,
  onClose,
  onConfirm,
}: AICodeGenerateModalProps) {
  const safeModelOptions = useMemo(
    () => (modelOptions.length > 0 ? modelOptions : [{ name: defaultModel, label: defaultModel }]),
    [defaultModel, modelOptions],
  )

  const [model, setModel] = useState(defaultModel)
  const [description, setDescription] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [generatedCode, setGeneratedCode] = useState('')
  const [errorText, setErrorText] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open)
      return
    const fallbackModel = safeModelOptions[0]?.name || defaultModel
    const allowed = new Set(safeModelOptions.map(item => item.name))
    const nextModel = allowed.has(defaultModel) ? defaultModel : fallbackModel
    setModel(nextModel)
    setDescription('')
    setSelectedKeys([])
    setGeneratedCode('')
    setErrorText('')
  }, [defaultModel, open, safeModelOptions])

  const selectedVariables = useMemo(
    () => variableOptions.filter(item => selectedKeys.includes(item.key)),
    [selectedKeys, variableOptions],
  )
  const variableTreeOptions = useMemo(
    () => buildWorkflowVariableTreeOptions(variableOptions),
    [variableOptions],
  )

  if (!open || !context)
    return null

  const title = context.title || `AI 生成${getTargetLabel(context.targetType)}`

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700" onClick={onClose}>关闭</button>
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-gray-500">模型</label>
          <Select
            className="w-full"
            value={model}
            options={safeModelOptions.map(item => ({ value: item.name, label: item.label || item.name }))}
            onChange={setModel}
          />

          <label className="block text-xs text-gray-500">引入参数（多选）</label>
          <TreeSelect
            className="w-full"
            multiple
            value={selectedKeys}
            showSearch
            treeData={variableTreeOptions}
            treeDefaultExpandAll
            popupMatchSelectWidth={false}
            filterTreeNode={(input, treeNode) => String(treeNode.title || '').toLowerCase().includes(input.toLowerCase())}
            onChange={value => setSelectedKeys((value as string[]) || [])}
          />

          <label className="block text-xs text-gray-500">需求描述</label>
          <textarea
            className="h-24 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            placeholder="请描述你要生成的代码逻辑"
            value={description}
            onChange={event => setDescription(event.target.value)}
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              disabled={loading}
              onClick={async () => {
                setErrorText('')
                setGeneratedCode('')
                const trimmedDescription = description.trim()
                if (!trimmedDescription) {
                  setErrorText('请先填写需求描述')
                  return
                }

                setLoading(true)
                try {
                  const result = await requestAICodeGenerate({
                    model,
                    targetType: context.targetType,
                    nodeType: context.nodeType,
                    language: context.language,
                    description: trimmedDescription,
                    selectedVariables: selectedVariables.map(item => ({
                      key: item.key,
                      placeholder: item.placeholder,
                      valueType: item.valueType,
                    })),
                    currentCode: context.currentCode,
                    context: {
                      nodeId: context.nodeId,
                      fieldName: context.fieldName,
                    },
                  })
                  setGeneratedCode(result.generatedCode)
                }
                catch (error) {
                  setErrorText(error instanceof Error ? error.message : '生成失败')
                }
                finally {
                  setLoading(false)
                }
              }}
            >
              {loading ? '生成中...' : '生成'}
            </button>
            <button
              type="button"
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
              disabled={!generatedCode.trim()}
              onClick={() => {
                onConfirm(generatedCode)
                onClose()
              }}
            >
              确定
            </button>
          </div>

          {errorText && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
              {errorText}
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs text-gray-500">生成结果</label>
            <textarea
              className="h-52 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
              value={generatedCode}
              onChange={event => setGeneratedCode(event.target.value)}
              placeholder="点击“生成”后显示结果"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
