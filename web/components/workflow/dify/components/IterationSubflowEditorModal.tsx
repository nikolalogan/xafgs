import { useEffect, useMemo, useRef, useState } from 'react'
import { Select } from 'antd'
import ReactFlow, {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  Handle,
  Position,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from 'reactflow'
import { createDefaultNodeConfig, ensureNodeConfig } from '../core/node-config'
import CodeEditorField from './CodeEditorField'
import VariableValueInput from './VariableValueInput'
import { buildWorkflowVariableOptions } from '../core/variables'
import {
  BlockEnum,
  type ApiRequestNodeConfig,
  type CodeNodeConfig,
  type DifyNode,
  type DifyNodeConfig,
  type EndNodeConfig,
  type HttpNodeConfig,
  type IfElseNodeConfig,
  type InputNodeConfig,
  type IterationNodeConfig,
  type LLMNodeConfig,
} from '../core/types'

type ChildNodeData = {
  title: string
  desc?: string
  type: BlockEnum
  config?: DifyNodeConfig
}

type ChildNode = Node<ChildNodeData>
type ChildEdge = Edge

type IterationSubflowEditorModalProps = {
  open: boolean
  value: IterationNodeConfig['children']
  onClose: () => void
  onSave: (nextValue: IterationNodeConfig['children']) => void
  mode?: 'modal' | 'embedded'
}

const nodeTypeLabel: Record<BlockEnum, string> = {
  [BlockEnum.Start]: '开始',
  [BlockEnum.End]: '结束',
  [BlockEnum.LLM]: 'LLM',
  [BlockEnum.IfElse]: '条件分支',
  [BlockEnum.Iteration]: '迭代',
  [BlockEnum.Code]: '代码',
  [BlockEnum.HttpRequest]: 'HTTP',
  [BlockEnum.ApiRequest]: 'API 请求',
  [BlockEnum.Input]: '输入',
}

const editableTypes: BlockEnum[] = [
  BlockEnum.LLM,
  BlockEnum.IfElse,
  BlockEnum.Code,
  BlockEnum.HttpRequest,
  BlockEnum.ApiRequest,
  BlockEnum.Input,
  BlockEnum.End,
]

const ChildNodeCard = ({ data, selected }: NodeProps<ChildNodeData>) => {
  return (
    <div className={`w-52 rounded-xl border bg-white p-2 shadow-sm ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-gray-400" />
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-900">{data.title}</div>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{nodeTypeLabel[data.type]}</span>
      </div>
      <div className="line-clamp-2 text-[10px] text-gray-500">{data.desc || '-'}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-gray-400" />
    </div>
  )
}

const nodeTypes = {
  childNode: ChildNodeCard,
}

const labelClass = 'block text-xs text-gray-500'
const inputClass = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'

function IterationSubflowEditorInner({
  value,
  onClose,
  onSave,
  mode = 'modal',
}: Omit<IterationSubflowEditorModalProps, 'open'>) {
  const [nodes, setNodes] = useState<ChildNode[]>([])
  const [edges, setEdges] = useState<ChildEdge[]>([])
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const configPanelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const nextNodes = (value.nodes ?? []).map((item) => ({
      ...item,
      type: 'childNode',
      data: {
        ...item.data,
        title: item.data.title || nodeTypeLabel[item.data.type] || item.id,
        config: item.data.config ?? createDefaultNodeConfig(item.data.type),
      },
    })) as ChildNode[]
    setNodes(nextNodes)
    setEdges((value.edges ?? []) as ChildEdge[])
    setViewport(value.viewport ?? { x: 0, y: 0, zoom: 1 })
    setActiveNodeId(null)
  }, [value])

  const activeNode = useMemo(
    () => nodes.find(node => node.id === activeNodeId) ?? null,
    [activeNodeId, nodes],
  )
  const variableOptions = useMemo(
    () => buildWorkflowVariableOptions(
      nodes as unknown as DifyNode[],
      [],
      [],
      activeNode as unknown as DifyNode | null,
    ),
    [activeNode, nodes],
  )

  const onNodesChange = (changes: NodeChange[]) => {
    setNodes(current => applyNodeChanges(changes, current) as ChildNode[])
  }

  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges(current => applyEdgeChanges(changes, current) as ChildEdge[])
  }

  const onConnect = (connection: Connection) => {
    setEdges(current => addEdge({
      ...connection,
      id: `sub-edge-${Date.now()}`,
      type: 'smoothstep',
    }, current))
  }

  const addNode = (type: BlockEnum) => {
    const id = `sub-node-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const nextNode: ChildNode = {
      id,
      type: 'childNode',
      position: { x: 120 + (nodes.length % 4) * 220, y: 100 + Math.floor(nodes.length / 4) * 130 },
      data: {
        type,
        title: `${nodeTypeLabel[type]}-${nodes.length + 1}`,
        desc: '',
        config: createDefaultNodeConfig(type),
      },
    }
    setNodes(current => [...current, nextNode])
  }

  const updateActiveNode = (patch: Partial<ChildNodeData>) => {
    if (!activeNode)
      return
    setNodes(current => current.map((node) => {
      if (node.id !== activeNode.id)
        return node
      return {
        ...node,
        data: {
          ...node.data,
          ...patch,
        },
      }
    }))
  }

  const updateActiveNodeConfig = (config: DifyNodeConfig) => {
    if (!activeNode)
      return
    setNodes(current => current.map((node) => {
      if (node.id !== activeNode.id)
        return node
      return {
        ...node,
        data: {
          ...node.data,
          config,
        },
      }
    }))
  }

  const renderNodeConfig = () => {
    if (!activeNode)
      return null

    if (activeNode.data.type === BlockEnum.LLM) {
      const config = ensureNodeConfig(BlockEnum.LLM, activeNode.data.config) as LLMNodeConfig
      return (
        <div className="space-y-2">
          <label className={labelClass}>模型</label>
          <input className={inputClass} value={config.model} onChange={event => updateActiveNodeConfig({ ...config, model: event.target.value })} />
          <label className={labelClass}>温度</label>
          <input className={inputClass} type="number" step="0.1" min="0" max="2" value={config.temperature} onChange={event => updateActiveNodeConfig({ ...config, temperature: Number(event.target.value || 0) })} />
          <label className={labelClass}>最大 Token</label>
          <input className={inputClass} type="number" min="1" value={config.maxTokens} onChange={event => updateActiveNodeConfig({ ...config, maxTokens: Number(event.target.value || 1) })} />
          <label className={labelClass}>重试次数</label>
          <input className={inputClass} type="number" min="0" step="1" value={config.retryCount ?? 0} onChange={event => updateActiveNodeConfig({ ...config, retryCount: Math.max(0, Math.floor(Number(event.target.value || 0))) })} />
          <label className={labelClass}>System Prompt</label>
          <textarea className="h-20 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" value={config.systemPrompt} onChange={event => updateActiveNodeConfig({ ...config, systemPrompt: event.target.value })} />
          <label className={labelClass}>User Prompt</label>
          <textarea className="h-20 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" value={config.userPrompt} onChange={event => updateActiveNodeConfig({ ...config, userPrompt: event.target.value })} />
          <label className={labelClass}>输出结果类型</label>
          <Select className="w-full" value={config.outputType} options={[{ value: 'string', label: 'string' }, { value: 'json', label: 'json' }]} onChange={value => updateActiveNodeConfig({ ...config, outputType: value === 'json' ? 'json' : 'string' })} />
          <label className={labelClass}>输出变量名</label>
          <input className={inputClass} value={config.outputVar} onChange={event => updateActiveNodeConfig({ ...config, outputVar: event.target.value })} />
        </div>
      )
    }

    if (activeNode.data.type === BlockEnum.Code) {
      const config = ensureNodeConfig(BlockEnum.Code, activeNode.data.config) as CodeNodeConfig
      return (
        <div className="space-y-2">
          <label className={labelClass}>语言</label>
          <Select className="w-full" value={config.language} options={[{ value: 'javascript', label: 'JavaScript' }, { value: 'python3', label: 'Python3' }]} onChange={value => updateActiveNodeConfig({ ...config, language: value as CodeNodeConfig['language'] })} />
          <label className={labelClass}>代码</label>
          <CodeEditorField
            value={config.code}
            onChange={nextCode => updateActiveNodeConfig({ ...config, code: nextCode })}
            options={[]}
            scope="all"
            onScopeChange={() => {}}
            showVariableInsert={false}
            className="h-36 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs"
          />
          <label className={labelClass}>输出变量（逗号分隔）</label>
          <input className={inputClass} value={config.outputs.join(',')} onChange={event => updateActiveNodeConfig({ ...config, outputs: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })} />
        </div>
      )
    }

    if (activeNode.data.type === BlockEnum.HttpRequest) {
      const config = ensureNodeConfig(BlockEnum.HttpRequest, activeNode.data.config) as HttpNodeConfig
      return (
        <div className="space-y-2">
          <label className={labelClass}>Method</label>
          <Select className="w-full" value={config.method} options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(item => ({ value: item, label: item }))} onChange={value => updateActiveNodeConfig({ ...config, method: value as HttpNodeConfig['method'] })} />
          <label className={labelClass}>URL</label>
          <input className={inputClass} value={config.url} onChange={event => updateActiveNodeConfig({ ...config, url: event.target.value })} />
          <label className={labelClass}>重试次数</label>
          <input className={inputClass} type="number" min="0" step="1" value={config.retryCount ?? 0} onChange={event => updateActiveNodeConfig({ ...config, retryCount: Math.max(0, Math.floor(Number(event.target.value || 0))) })} />
          <label className={labelClass}>Body</label>
          <textarea className="h-24 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" value={config.body} onChange={event => updateActiveNodeConfig({ ...config, body: event.target.value })} />
        </div>
      )
    }

    if (activeNode.data.type === BlockEnum.ApiRequest) {
      const config = ensureNodeConfig(BlockEnum.ApiRequest, activeNode.data.config) as ApiRequestNodeConfig
      return (
        <div className="space-y-2">
          <label className={labelClass}>Method</label>
          <Select className="w-full" value={config.route.method} options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(item => ({ value: item, label: item }))} onChange={value => updateActiveNodeConfig({ ...config, route: { ...config.route, method: value as ApiRequestNodeConfig['route']['method'] } })} />
          <label className={labelClass}>路径</label>
          <input className={inputClass} value={config.route.path} onChange={event => updateActiveNodeConfig({ ...config, route: { ...config.route, path: event.target.value } })} />
          <label className={labelClass}>超时（秒）</label>
          <input className={inputClass} type="number" min="1" value={config.timeout} onChange={event => updateActiveNodeConfig({ ...config, timeout: Math.max(1, Number(event.target.value || 1)) })} />
          <label className={labelClass}>重试次数</label>
          <input className={inputClass} type="number" min="0" step="1" value={config.retryCount ?? 0} onChange={event => updateActiveNodeConfig({ ...config, retryCount: Math.max(0, Math.floor(Number(event.target.value || 0))) })} />
        </div>
      )
    }

    if (activeNode.data.type === BlockEnum.IfElse) {
      const config = ensureNodeConfig(BlockEnum.IfElse, activeNode.data.config) as IfElseNodeConfig
      return (
        <div className="space-y-2">
          <label className={labelClass}>Else 分支名称</label>
          <input className={inputClass} value={config.elseBranchName} onChange={event => updateActiveNodeConfig({ ...config, elseBranchName: event.target.value })} />
          <label className={labelClass}>条件数量</label>
          <input
            className={inputClass}
            type="number"
            min="0"
            value={config.conditions.length}
            onChange={event => {
              const nextCount = Number(event.target.value || 0)
              const base = [...config.conditions]
              while (base.length < nextCount)
                base.push({ name: `分支${base.length + 1}`, left: '', operator: 'contains', right: '' })
              updateActiveNodeConfig({ ...config, conditions: base.slice(0, nextCount) })
            }}
          />
        </div>
      )
    }

    if (activeNode.data.type === BlockEnum.Input) {
      const config = ensureNodeConfig(BlockEnum.Input, activeNode.data.config) as InputNodeConfig
      return (
        <div className="space-y-2">
          <VariableValueInput
            label="提示词"
            value={config.prompt ?? ''}
            onChange={nextValue => updateActiveNodeConfig({ ...config, prompt: nextValue })}
            options={variableOptions}
            allowMultiline
            rows={4}
            placeholder="请输入提示词（可插入参数）"
          />
          <label className={labelClass}>字段数量</label>
          <input
            className={inputClass}
            type="number"
            min="1"
            value={config.fields.length}
            onChange={event => {
              const nextCount = Math.max(1, Number(event.target.value || 1))
              const base = [...config.fields]
              while (base.length < nextCount) {
                base.push({ name: '', label: '', type: 'text', required: false, options: [], defaultValue: '' })
              }
              updateActiveNodeConfig({ ...config, fields: base.slice(0, nextCount) })
            }}
          />
        </div>
      )
    }

    if (activeNode.data.type === BlockEnum.End) {
      const config = ensureNodeConfig(BlockEnum.End, activeNode.data.config) as EndNodeConfig
      return (
        <div className="space-y-2">
          <label className={labelClass}>输出数量</label>
          <input
            className={inputClass}
            type="number"
            min="1"
            value={config.outputs.length || 1}
            onChange={event => {
              const nextCount = Math.max(1, Number(event.target.value || 1))
              const base = [...config.outputs]
              while (base.length < nextCount)
                base.push({ name: '', source: '' })
              updateActiveNodeConfig({ ...config, outputs: base.slice(0, nextCount) })
            }}
          />
        </div>
      )
    }

    return (
      <div className="text-xs text-gray-500">该类型暂未提供配置项。</div>
    )
  }

  const commitSave = () => {
    onSave({
      nodes: nodes.map(node => ({ ...node, type: 'childNode' })),
      edges: edges.map(edge => ({
        ...edge,
        sourceHandle: edge.sourceHandle ?? undefined,
        targetHandle: edge.targetHandle ?? undefined,
      })),
      viewport,
    })
  }

  const handleConfigPanelBlurCapture = () => {
    window.requestAnimationFrame(() => {
      const root = configPanelRef.current
      if (!root)
        return
      const activeElement = document.activeElement
      if (activeElement instanceof Node && root.contains(activeElement))
        return
      commitSave()
    })
  }

  const containerClassName = mode === 'embedded'
    ? 'h-full w-full rounded-xl border border-gray-200 bg-white p-3 shadow-sm'
    : 'h-[84vh] w-[92vw] rounded-2xl bg-white p-3 shadow-2xl'

  const wrapperClassName = mode === 'embedded'
    ? 'h-full w-full'
    : 'fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4'

  return (
    <div className={wrapperClassName}>
      <div className={containerClassName}>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">迭代子流程编辑</div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded border border-gray-300 px-2 py-1 text-xs">取消</button>
          </div>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {editableTypes.map(type => (
            <button
              key={type}
              onClick={() => addNode(type)}
              className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
            >
              新增{nodeTypeLabel[type]}
            </button>
          ))}
        </div>
        <div className={`grid grid-cols-12 gap-3 ${mode === 'embedded' ? 'h-[calc(100%-72px)]' : 'h-[calc(84vh-88px)]'}`}>
          <div className="col-span-9 overflow-hidden rounded-xl border border-gray-200">
            <ReactFlow
              nodeTypes={nodeTypes}
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => setActiveNodeId(node.id)}
              onPaneClick={() => setActiveNodeId(null)}
              onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
            >
              <MiniMap pannable zoomable style={{ width: 110, height: 70 }} />
              <Controls />
              <Background gap={14} size={1.5} color="#d1d5db" />
            </ReactFlow>
          </div>
          <div
            ref={configPanelRef}
            className="col-span-3 rounded-xl border border-gray-200 p-3"
            onBlurCapture={handleConfigPanelBlurCapture}
          >
            <div className="mb-2 text-sm font-semibold">子节点配置</div>
            {!activeNode && (
              <div className="text-xs text-gray-500">点击左侧子节点进行编辑</div>
            )}
            {activeNode && (
              <div className="space-y-2">
                <label className="block text-xs text-gray-500">标题</label>
                <input
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  value={activeNode.data.title}
                  onChange={event => updateActiveNode({ title: event.target.value })}
                />
                <label className="block text-xs text-gray-500">描述</label>
                <textarea
                  className="h-24 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  value={activeNode.data.desc || ''}
                  onChange={event => updateActiveNode({ desc: event.target.value })}
                />
                {activeNode.data.type !== BlockEnum.Start && (
                  <div className="space-y-1 rounded border border-gray-200 p-2">
                    <label className={labelClass}>多入边汇聚策略</label>
                    <Select
                      className="w-full"
                      value={activeNode.data.config && typeof activeNode.data.config === 'object' && (activeNode.data.config as { joinMode?: unknown }).joinMode === 'any' ? 'any' : 'all'}
                      options={[
                        { value: 'all', label: '等待全部上游（all）' },
                        { value: 'any', label: '任一上游到达即执行（any）' },
                      ]}
                      onChange={(value) => {
                        const base = ensureNodeConfig(activeNode.data.type as never, activeNode.data.config as never) as Record<string, unknown>
                        updateActiveNodeConfig({
                          ...base,
                          joinMode: value === 'any' ? 'any' : 'all',
                        } as DifyNodeConfig)
                      }}
                    />
                    <div className="text-[11px] text-gray-400">仅当当前节点存在多条输入连线时生效。</div>
                  </div>
                )}
                {renderNodeConfig()}
                <button
                  className="rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                  onClick={() => {
                    setNodes(current => current.filter(node => node.id !== activeNode.id))
                    setEdges(current => current.filter(edge => edge.source !== activeNode.id && edge.target !== activeNode.id))
                    setActiveNodeId(null)
                  }}
                >
                  删除子节点
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function IterationSubflowEditorModal(props: IterationSubflowEditorModalProps) {
  if (!props.open)
    return null

  return (
    <ReactFlowProvider>
      <IterationSubflowEditorInner
        value={props.value}
        onClose={props.onClose}
        onSave={props.onSave}
        mode={props.mode}
      />
    </ReactFlowProvider>
  )
}
