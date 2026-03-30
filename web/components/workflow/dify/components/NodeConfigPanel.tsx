import { useEffect, useMemo } from 'react'
import StartNodeFormConfig from './StartNodeFormConfig'
import VariableValueInput from './VariableValueInput'
import CodeEditorField from './CodeEditorField'
import { createDefaultNodeConfig, ensureNodeConfig } from '../core/node-config'
import { extractSchemaLeafPaths } from '../core/json-schema'
import { adaptInputConfigToStartConfig, adaptStartConfigToInputConfig } from '../core/variable-form-adapter'
import { buildWorkflowVariableOptions, type VariableScope } from '../core/variables'
import {
  BlockEnum,
  type CodeNodeConfig,
  type DifyNode,
  type EndNodeConfig,
  type HttpNodeConfig,
  type IfElseNodeConfig,
  type InputNodeConfig,
  type IterationNodeConfig,
  type LLMNodeConfig,
  type StartNodeConfig,
  type WorkflowGlobalVariable,
  type WorkflowParameter,
  type WorkflowVariableScope,
} from '../core/types'

type NodeConfigPanelProps = {
  nodes: DifyNode[]
  workflowParameters: WorkflowParameter[]
  globalVariables: WorkflowGlobalVariable[]
  workflowVariableScopes: Record<string, WorkflowVariableScope>
  activeNode: DifyNode | null
  onChange: (node: DifyNode) => void
  onChangeScopes: (scopes: Record<string, WorkflowVariableScope>) => void
  onFocusIterationRegion: (nodeId: string) => void
  onSave: () => void
}

const labelClass = 'block text-xs text-gray-500'
const inputClass = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'
const sectionClass = 'space-y-2 rounded border border-gray-200 p-2'

export default function NodeConfigPanel({
  nodes,
  workflowParameters,
  globalVariables,
  workflowVariableScopes,
  activeNode,
  onChange,
  onChangeScopes,
  onFocusIterationRegion,
  onSave,
}: NodeConfigPanelProps) {
  const variableOptions = useMemo(
    () => buildWorkflowVariableOptions(nodes, workflowParameters, globalVariables, activeNode),
    [activeNode, globalVariables, nodes, workflowParameters],
  )
  const mappingTargetOptions = useMemo(
    () => variableOptions.filter(option => option.nodeId === 'workflow' || option.nodeId === 'global'),
    [variableOptions],
  )

  const getScope = (fieldKey: string, fallback: VariableScope = 'all') => workflowVariableScopes[fieldKey] ?? fallback
  const setScope = (fieldKey: string, scope: VariableScope) => {
    onChangeScopes({
      ...workflowVariableScopes,
      [fieldKey]: scope,
    })
  }

  useEffect(() => {
    if (!activeNode)
      return

    if (activeNode.data.config)
      return

    onChange({
      ...activeNode,
      data: {
        ...activeNode.data,
        config: createDefaultNodeConfig(activeNode.data.type),
      },
    })
  }, [activeNode, onChange])

  if (!activeNode) {
    return (
      <div className="col-span-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="mb-2 text-sm font-semibold">节点配置</div>
        <p className="text-xs text-gray-500">点击画布中的节点后可编辑</p>
      </div>
    )
  }

  const updateNode = (nextNode: DifyNode) => onChange(nextNode)

  const updateBase = (patch: Partial<DifyNode['data']>) => {
    updateNode({
      ...activeNode,
      data: {
        ...activeNode.data,
        ...patch,
      },
    })
  }

  const renderStartConfig = () => {
    const config = ensureNodeConfig(BlockEnum.Start, activeNode.data.config) as StartNodeConfig
    return (
      <StartNodeFormConfig
        nodeId={activeNode.id}
        config={config}
        onChange={nextConfig => updateBase({ config: nextConfig })}
        variableOptions={variableOptions}
        getScope={getScope}
        onScopeChange={setScope}
      />
    )
  }

  const renderInputConfig = () => {
    const config = ensureNodeConfig(BlockEnum.Input, activeNode.data.config) as InputNodeConfig
    const adaptedStartConfig = adaptInputConfigToStartConfig(config)

    const handleChange = (nextConfig: StartNodeConfig) => {
      updateBase({
        config: adaptStartConfigToInputConfig(config, nextConfig),
      })
    }

    return (
      <StartNodeFormConfig
        nodeId={activeNode.id}
        sectionKey="input"
        title="输入节点表单"
        addButtonLabel="新增字段"
        allowedTypes={['text-input', 'paragraph', 'number', 'select']}
        config={adaptedStartConfig}
        onChange={handleChange}
        variableOptions={variableOptions}
        getScope={getScope}
        onScopeChange={setScope}
      />
    )
  }

  const renderLLMConfig = () => {
    const config = ensureNodeConfig(BlockEnum.LLM, activeNode.data.config) as LLMNodeConfig
    const updateConfig = (nextConfig: LLMNodeConfig) => updateBase({ config: nextConfig })
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">LLM 配置</div>
        <label className={labelClass}>模型</label>
        <input className={inputClass} value={config.model} onChange={event => updateConfig({ ...config, model: event.target.value })} />
        <label className={labelClass}>温度</label>
        <input className={inputClass} type="number" step="0.1" min="0" max="2" value={config.temperature} onChange={event => updateConfig({ ...config, temperature: Number(event.target.value || 0) })} />
        <label className={labelClass}>最大 Token</label>
        <input className={inputClass} type="number" min="1" value={config.maxTokens} onChange={event => updateConfig({ ...config, maxTokens: Number(event.target.value || 1) })} />
        <VariableValueInput
          label="System Prompt"
          value={config.systemPrompt}
          onChange={nextValue => updateConfig({ ...config, systemPrompt: nextValue })}
          options={variableOptions}
          scope={getScope(`${activeNode.id}.llm.systemPrompt`, 'all')}
          onScopeChange={scope => setScope(`${activeNode.id}.llm.systemPrompt`, scope)}
          allowMultiline
          rows={4}
        />
        <VariableValueInput
          label="User Prompt"
          value={config.userPrompt}
          onChange={nextValue => updateConfig({ ...config, userPrompt: nextValue })}
          options={variableOptions}
          scope={getScope(`${activeNode.id}.llm.userPrompt`, 'all')}
          onScopeChange={scope => setScope(`${activeNode.id}.llm.userPrompt`, scope)}
          allowMultiline
          rows={4}
        />
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" checked={config.contextEnabled} onChange={event => updateConfig({ ...config, contextEnabled: event.target.checked })} />
          启用上下文
        </label>
      </div>
    )
  }

  const renderIfElseConfig = () => {
    const config = ensureNodeConfig(BlockEnum.IfElse, activeNode.data.config) as IfElseNodeConfig
    const updateConfig = (nextConfig: IfElseNodeConfig) => updateBase({ config: nextConfig })
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">条件分支</div>
        {config.conditions.map((condition, index) => (
          <div key={`if-condition-${index}`} className="space-y-1 rounded border border-gray-200 p-2">
            <label className={labelClass}>分支名称</label>
            <input
              className={inputClass}
              value={condition.name}
              onChange={(event) => {
                const next = [...config.conditions]
                next[index] = { ...condition, name: event.target.value }
                updateConfig({ ...config, conditions: next })
              }}
            />
            <VariableValueInput
              label="变量名"
              value={condition.left}
              options={variableOptions}
              scope={getScope(`${activeNode.id}.if.left.${index}`, 'all')}
              onScopeChange={scope => setScope(`${activeNode.id}.if.left.${index}`, scope)}
              onChange={(nextValue) => {
                const next = [...config.conditions]
                next[index] = { ...condition, left: nextValue }
                updateConfig({ ...config, conditions: next })
              }}
            />
            <select
              className={inputClass}
              value={condition.operator}
              onChange={(event) => {
                const next = [...config.conditions]
                next[index] = { ...condition, operator: event.target.value as IfElseNodeConfig['conditions'][number]['operator'] }
                updateConfig({ ...config, conditions: next })
              }}
            >
              <option value="contains">包含</option>
              <option value="not_contains">不包含</option>
              <option value="eq">等于</option>
              <option value="neq">不等于</option>
              <option value="gt">大于</option>
              <option value="lt">小于</option>
              <option value="empty">为空</option>
              <option value="not_empty">不为空</option>
            </select>
            <VariableValueInput
              label="比较值"
              value={condition.right}
              options={variableOptions}
              scope={getScope(`${activeNode.id}.if.right.${index}`, 'all')}
              onScopeChange={scope => setScope(`${activeNode.id}.if.right.${index}`, scope)}
              onChange={(nextValue) => {
                const next = [...config.conditions]
                next[index] = { ...condition, right: nextValue }
                updateConfig({ ...config, conditions: next })
              }}
            />
            <button
              onClick={() => {
                const next = config.conditions.filter((_, idx) => idx !== index)
                updateConfig({ ...config, conditions: next })
              }}
              className="rounded bg-red-50 px-2 py-1 text-xs text-red-600"
            >
              删除条件
            </button>
          </div>
        ))}
        <button
          onClick={() => updateConfig({
            ...config,
            conditions: [...config.conditions, { name: `分支${config.conditions.length + 1}`, left: '', operator: 'contains', right: '' }],
          })}
          className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
        >
          新增条件
        </button>
        <div className="rounded border border-dashed border-gray-300 p-2">
          <label className={labelClass}>Else 分支名称（兜底分支）</label>
          <input
            className={inputClass}
            value={config.elseBranchName}
            onChange={event => updateConfig({ ...config, elseBranchName: event.target.value })}
          />
        </div>
      </div>
    )
  }

  const renderCodeConfig = () => {
    const config = ensureNodeConfig(BlockEnum.Code, activeNode.data.config) as CodeNodeConfig
    const updateConfig = (nextConfig: CodeNodeConfig) => updateBase({ config: nextConfig })
    const codeScopeKey = `${activeNode.id}.code.content`
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">代码节点</div>
        <label className={labelClass}>语言</label>
        <select
          className={inputClass}
          value={config.language}
          onChange={event => updateConfig({ ...config, language: event.target.value as CodeNodeConfig['language'] })}
        >
          <option value="javascript">JavaScript</option>
          <option value="python3">Python3</option>
        </select>
        <label className={labelClass}>代码</label>
        <CodeEditorField
          value={config.code}
          onChange={nextCode => updateConfig({ ...config, code: nextCode })}
          options={variableOptions}
          scope={getScope(codeScopeKey, 'all')}
          onScopeChange={scope => setScope(codeScopeKey, scope)}
        />
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="text-xs font-semibold text-gray-700">输出写入参数</div>
          <label className={labelClass}>输出 JSON Schema（可选）</label>
          <textarea
            className="h-28 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
            placeholder={`{\n  "type": "object",\n  "properties": {\n    "result": { "type": "string" }\n  }\n}`}
            value={config.outputSchema ?? ''}
            onChange={event => updateConfig({ ...config, outputSchema: event.target.value })}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
              onClick={() => {
                const parsed = extractSchemaLeafPaths(config.outputSchema ?? '')
                if (!parsed.ok)
                  return
                const generated = parsed.paths.map(path => ({
                  sourcePath: path,
                  targetPath: '',
                }))
                updateConfig({
                  ...config,
                  writebackMappings: generated,
                })
              }}
            >
              按 Schema 生成映射
            </button>
          </div>
          <div className="space-y-2">
            {config.writebackMappings.length === 0 && (
              <div className="rounded border border-dashed border-gray-300 px-2 py-2 text-xs text-gray-500">
                请先配置输出 Schema 并点击“按 Schema 生成映射”。
              </div>
            )}
            {config.writebackMappings.map((mapping, index) => (
              <div key={`code-writeback-${index}`} className="grid grid-cols-12 gap-2">
                <div
                  className="col-span-5 truncate rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs text-gray-700"
                  style={{ paddingLeft: `${8 + Math.max(0, mapping.sourcePath.split('.').length - 1) * 10}px` }}
                  title={mapping.sourcePath}
                >
                  {mapping.sourcePath}
                </div>
                <select
                  className={`${inputClass} col-span-5`}
                  value={mapping.targetPath}
                  onChange={(event) => {
                    const next = [...config.writebackMappings]
                    next[index] = { ...mapping, targetPath: event.target.value }
                    updateConfig({ ...config, writebackMappings: next })
                  }}
                >
                  <option value="">选择全局/流程参数</option>
                  {mappingTargetOptions.map(option => (
                    <option key={`code-map-${index}-${option.key}`} value={option.key}>{option.displayLabel}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="col-span-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                  onClick={() => updateConfig({
                    ...config,
                    writebackMappings: config.writebackMappings.filter((_, idx) => idx !== index),
                  })}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
        <label className={labelClass}>输出变量（逗号分隔）</label>
        <input
          className={inputClass}
          value={config.outputs.join(',')}
          onChange={(event) => updateConfig({
            ...config,
            outputs: event.target.value.split(',').map(item => item.trim()).filter(Boolean),
          })}
        />
      </div>
    )
  }

  const renderIterationConfig = () => {
    const config = ensureNodeConfig(BlockEnum.Iteration, activeNode.data.config) as IterationNodeConfig
    const updateConfig = (nextConfig: IterationNodeConfig) => updateBase({ config: nextConfig })
    const childTypes: Array<{ type: BlockEnum; label: string }> = [
      { type: BlockEnum.LLM, label: 'LLM' },
      { type: BlockEnum.Code, label: '代码' },
      { type: BlockEnum.HttpRequest, label: 'HTTP' },
      { type: BlockEnum.IfElse, label: '条件分支' },
      { type: BlockEnum.Input, label: '输入' },
      { type: BlockEnum.End, label: '结束' },
    ]
    const addChildNode = (type: BlockEnum) => {
      const nextIndex = config.children.nodes.length + 1
      const nextNodeId = `sub-node-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const nextNode = {
        id: nextNodeId,
        type: 'childNode',
        position: {
          x: 40 + (config.children.nodes.length % 3) * 240,
          y: 40 + Math.floor(config.children.nodes.length / 3) * 150,
        },
        data: {
          title: `${type}-${nextIndex}`,
          desc: '',
          type,
          config: createDefaultNodeConfig(type),
        },
      }
      updateConfig({
        ...config,
        children: {
          ...config.children,
          nodes: [...config.children.nodes, nextNode],
        },
      })
    }
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">迭代节点</div>
        <VariableValueInput
          label="迭代输入（Array）"
          value={config.iteratorSource}
          onChange={nextValue => updateConfig({ ...config, iteratorSource: nextValue })}
          options={variableOptions}
          scope={getScope(`${activeNode.id}.iteration.iteratorSource`, 'array')}
          onScopeChange={scope => setScope(`${activeNode.id}.iteration.iteratorSource`, scope)}
          placeholder="例如 {{input.items}}"
        />
        <VariableValueInput
          label="输出来源（迭代体内变量）"
          value={config.outputSource}
          onChange={nextValue => updateConfig({ ...config, outputSource: nextValue })}
          options={variableOptions}
          scope={getScope(`${activeNode.id}.iteration.outputSource`, 'all')}
          onScopeChange={scope => setScope(`${activeNode.id}.iteration.outputSource`, scope)}
          placeholder="例如 {{code.result}}"
        />
        <label className={labelClass}>输出变量名</label>
        <input
          className={inputClass}
          value={config.outputVar}
          placeholder="results"
          onChange={event => updateConfig({ ...config, outputVar: event.target.value })}
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>迭代项变量名</label>
            <input
              className={inputClass}
              value={config.itemVar}
              placeholder="item"
              onChange={event => updateConfig({ ...config, itemVar: event.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>索引变量名</label>
            <input
              className={inputClass}
              value={config.indexVar}
              placeholder="index"
              onChange={event => updateConfig({ ...config, indexVar: event.target.value })}
            />
          </div>
        </div>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={config.isParallel}
            onChange={event => updateConfig({ ...config, isParallel: event.target.checked })}
          />
          并行模式
        </label>
        {config.isParallel && (
          <>
            <label className={labelClass}>最大并行数</label>
            <input
              className={inputClass}
              type="number"
              min="1"
              max="100"
              value={config.parallelNums}
              onChange={event => updateConfig({ ...config, parallelNums: Number(event.target.value || 1) })}
            />
          </>
        )}
        <label className={labelClass}>错误处理方式</label>
        <select
          className={inputClass}
          value={config.errorHandleMode}
          onChange={event => updateConfig({ ...config, errorHandleMode: event.target.value as IterationNodeConfig['errorHandleMode'] })}
        >
          <option value="terminated">终止执行</option>
          <option value="continue-on-error">遇错继续</option>
          <option value="remove-abnormal-output">移除异常输出</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={config.flattenOutput}
            onChange={event => updateConfig({ ...config, flattenOutput: event.target.checked })}
          />
          扁平化输出
        </label>
        <div className="rounded border border-gray-200 p-2">
          <div className="mb-1 text-xs text-gray-600">
            子流程节点：{config.children.nodes.length}，连线：{config.children.edges.length}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {childTypes.map(item => (
              <button
                key={item.type}
                onClick={() => addChildNode(item.type)}
                className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
              >
                + {item.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => onFocusIterationRegion(activeNode.id)}
            className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
          >
            定位迭代区域
          </button>
        </div>
      </div>
    )
  }

  const renderHttpConfig = () => {
    const config = ensureNodeConfig(BlockEnum.HttpRequest, activeNode.data.config) as HttpNodeConfig
    const updateConfig = (nextConfig: HttpNodeConfig) => updateBase({ config: nextConfig })
    const updateKeyValueItem = (
      key: 'query' | 'headers',
      index: number,
      patch: Partial<HttpNodeConfig['query'][number]>,
    ) => {
      const nextList = [...config[key]]
      nextList[index] = { ...nextList[index], ...patch }
      updateConfig({ ...config, [key]: nextList })
    }
    const removeKeyValueItem = (key: 'query' | 'headers', index: number) => {
      const nextList = config[key].filter((_, idx) => idx !== index)
      updateConfig({ ...config, [key]: nextList })
    }
    const addKeyValueItem = (key: 'query' | 'headers') => {
      updateConfig({
        ...config,
        [key]: [...config[key], { key: '', value: '' }],
      })
    }
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">HTTP 请求</div>
        <label className={labelClass}>Method</label>
        <select
          className={inputClass}
          value={config.method}
          onChange={event => updateConfig({ ...config, method: event.target.value as HttpNodeConfig['method'] })}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
        <VariableValueInput
          label="URL"
          value={config.url}
          onChange={nextValue => updateConfig({ ...config, url: nextValue })}
          options={variableOptions}
          scope={getScope(`${activeNode.id}.http.url`, 'string')}
          onScopeChange={scope => setScope(`${activeNode.id}.http.url`, scope)}
          placeholder="https://api.example.com/items/{{start.query}}"
        />
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="text-xs font-semibold text-gray-700">Query 参数</div>
          {config.query.map((item, index) => (
            <div key={`query-${index}`} className="grid grid-cols-12 gap-2">
              <input
                className={`${inputClass} col-span-5`}
                placeholder="key"
                value={item.key}
                onChange={event => updateKeyValueItem('query', index, { key: event.target.value })}
              />
              <div className="col-span-5">
                <VariableValueInput
                  value={item.value}
                  onChange={nextValue => updateKeyValueItem('query', index, { value: nextValue })}
                  options={variableOptions}
                  scope={getScope(`${activeNode.id}.http.query.${index}`, 'all')}
                  onScopeChange={scope => setScope(`${activeNode.id}.http.query.${index}`, scope)}
                />
              </div>
              <button
                className="col-span-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                onClick={() => removeKeyValueItem('query', index)}
              >
                删除
              </button>
            </div>
          ))}
          <button
            className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
            onClick={() => addKeyValueItem('query')}
          >
            新增 Query
          </button>
        </div>
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="text-xs font-semibold text-gray-700">Headers</div>
          {config.headers.map((item, index) => (
            <div key={`header-${index}`} className="grid grid-cols-12 gap-2">
              <input
                className={`${inputClass} col-span-5`}
                placeholder="key"
                value={item.key}
                onChange={event => updateKeyValueItem('headers', index, { key: event.target.value })}
              />
              <div className="col-span-5">
                <VariableValueInput
                  value={item.value}
                  onChange={nextValue => updateKeyValueItem('headers', index, { value: nextValue })}
                  options={variableOptions}
                  scope={getScope(`${activeNode.id}.http.headers.${index}`, 'all')}
                  onScopeChange={scope => setScope(`${activeNode.id}.http.headers.${index}`, scope)}
                />
              </div>
              <button
                className="col-span-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                onClick={() => removeKeyValueItem('headers', index)}
              >
                删除
              </button>
            </div>
          ))}
          <button
            className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
            onClick={() => addKeyValueItem('headers')}
          >
            新增 Header
          </button>
        </div>
        <label className={labelClass}>认证类型</label>
        <select
          className={inputClass}
          value={config.authorization.type}
          onChange={event => updateConfig({
            ...config,
            authorization: { ...config.authorization, type: event.target.value as HttpNodeConfig['authorization']['type'] },
          })}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer</option>
          <option value="api-key">API Key</option>
        </select>
        {config.authorization.type !== 'none' && (
          <div className="space-y-2">
            <VariableValueInput
              value={config.authorization.apiKey}
              placeholder={config.authorization.type === 'api-key' ? 'API Key' : 'Bearer Token'}
              onChange={nextValue => updateConfig({
                ...config,
                authorization: { ...config.authorization, apiKey: nextValue },
              })}
              options={variableOptions}
              scope={getScope(`${activeNode.id}.http.auth.apiKey`, 'all')}
              onScopeChange={scope => setScope(`${activeNode.id}.http.auth.apiKey`, scope)}
            />
            {config.authorization.type === 'api-key' && (
              <input
                className={inputClass}
                placeholder="Header 名（默认 Authorization）"
                value={config.authorization.header}
                onChange={event => updateConfig({
                  ...config,
                  authorization: { ...config.authorization, header: event.target.value },
                })}
              />
            )}
          </div>
        )}
        <label className={labelClass}>Body 类型</label>
        <select
          className={inputClass}
          value={config.bodyType}
          onChange={event => updateConfig({ ...config, bodyType: event.target.value as HttpNodeConfig['bodyType'] })}
        >
          <option value="none">None</option>
          <option value="json">JSON</option>
          <option value="x-www-form-urlencoded">x-www-form-urlencoded</option>
          <option value="form-data">form-data</option>
          <option value="raw">Raw Text</option>
        </select>
        {config.bodyType !== 'none' && (
          <VariableValueInput
            value={config.body}
            onChange={nextValue => updateConfig({ ...config, body: nextValue })}
            options={variableOptions}
            scope={getScope(`${activeNode.id}.http.body`, config.bodyType === 'json' ? 'object' : 'all')}
            onScopeChange={scope => setScope(`${activeNode.id}.http.body`, scope)}
            allowMultiline
            rows={5}
          />
        )}
        <label className={labelClass}>超时（秒）</label>
        <input
          className={inputClass}
          type="number"
          min="1"
          value={config.timeout}
          onChange={event => updateConfig({ ...config, timeout: Number(event.target.value || 1) })}
        />
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="text-xs font-semibold text-gray-700">响应写入参数</div>
          <label className={labelClass}>响应 JSON Schema（可选）</label>
          <textarea
            className="h-28 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
            placeholder={`{\n  "type": "object",\n  "properties": {\n    "data": { "type": "object" }\n  }\n}`}
            value={config.outputSchema ?? ''}
            onChange={event => updateConfig({ ...config, outputSchema: event.target.value })}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
              onClick={() => {
                const parsed = extractSchemaLeafPaths(config.outputSchema ?? '')
                if (!parsed.ok)
                  return
                const generated = parsed.paths.map(path => ({
                  sourcePath: path,
                  targetPath: '',
                }))
                updateConfig({
                  ...config,
                  writebackMappings: generated,
                })
              }}
            >
              按 Schema 生成映射
            </button>
          </div>
          <div className="space-y-2">
            {config.writebackMappings.length === 0 && (
              <div className="rounded border border-dashed border-gray-300 px-2 py-2 text-xs text-gray-500">
                请先配置响应 Schema 并点击“按 Schema 生成映射”。
              </div>
            )}
            {config.writebackMappings.map((mapping, index) => (
              <div key={`http-writeback-${index}`} className="grid grid-cols-12 gap-2">
                <div
                  className="col-span-5 truncate rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs text-gray-700"
                  style={{ paddingLeft: `${8 + Math.max(0, mapping.sourcePath.split('.').length - 1) * 10}px` }}
                  title={mapping.sourcePath}
                >
                  {mapping.sourcePath}
                </div>
                <select
                  className={`${inputClass} col-span-5`}
                  value={mapping.targetPath}
                  onChange={(event) => {
                    const next = [...config.writebackMappings]
                    next[index] = { ...mapping, targetPath: event.target.value }
                    updateConfig({ ...config, writebackMappings: next })
                  }}
                >
                  <option value="">选择全局/流程参数</option>
                  {mappingTargetOptions.map(option => (
                    <option key={`http-map-${index}-${option.key}`} value={option.key}>{option.displayLabel}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="col-span-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600"
                  onClick={() => updateConfig({
                    ...config,
                    writebackMappings: config.writebackMappings.filter((_, idx) => idx !== index),
                  })}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const renderEndConfig = () => {
    const config = ensureNodeConfig(BlockEnum.End, activeNode.data.config) as EndNodeConfig
    const updateConfig = (nextConfig: EndNodeConfig) => updateBase({ config: nextConfig })
    return (
      <div className={sectionClass}>
        <div className="text-xs font-semibold text-gray-700">结束节点输出</div>
        {config.outputs.map((item, index) => (
          <div key={`end-output-${index}`} className="space-y-1 rounded border border-gray-200 p-2">
            <input
              className={inputClass}
              placeholder="输出变量名"
              value={item.name}
              onChange={(event) => {
                const next = [...config.outputs]
                next[index] = { ...item, name: event.target.value }
                updateConfig({ ...config, outputs: next })
              }}
            />
            <VariableValueInput
              label="来源变量"
              value={item.source}
              onChange={(nextValue) => {
                const next = [...config.outputs]
                next[index] = { ...item, source: nextValue }
                updateConfig({ ...config, outputs: next })
              }}
              options={variableOptions}
              scope={getScope(`${activeNode.id}.end.source.${index}`, 'all')}
              onScopeChange={scope => setScope(`${activeNode.id}.end.source.${index}`, scope)}
              placeholder="选择变量或手动输入，例如 {{llm-1.text}}"
            />
            <button
              onClick={() => {
                const next = config.outputs.filter((_, idx) => idx !== index)
                updateConfig({ ...config, outputs: next })
              }}
              className="rounded bg-red-50 px-2 py-1 text-xs text-red-600"
            >
              删除输出
            </button>
          </div>
        ))}
        <button
          onClick={() => updateConfig({
            ...config,
            outputs: [...config.outputs, { name: '', source: '' }],
          })}
          className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
        >
          新增输出
        </button>
      </div>
    )
  }

  const renderNodeSpecificConfig = () => {
    const nodeType = activeNode.data.type
    if (nodeType === BlockEnum.Start) return renderStartConfig()
    if (nodeType === BlockEnum.Input) return renderInputConfig()
    if (nodeType === BlockEnum.LLM) return renderLLMConfig()
    if (nodeType === BlockEnum.IfElse) return renderIfElseConfig()
    if (nodeType === BlockEnum.Iteration) return renderIterationConfig()
    if (nodeType === BlockEnum.Code) return renderCodeConfig()
    if (nodeType === BlockEnum.HttpRequest) return renderHttpConfig()
    if (nodeType === BlockEnum.End) return renderEndConfig()
    return null
  }

  return (
    <div className="col-span-3 rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-2 text-sm font-semibold">节点配置</div>
      <div className="space-y-2">
        <label className={labelClass}>标题</label>
        <input
          className={inputClass}
          value={activeNode.data.title}
          onChange={event => updateBase({ title: event.target.value })}
        />
        <label className={labelClass}>描述</label>
        <textarea
          className="h-20 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          value={activeNode.data.desc || ''}
          onChange={event => updateBase({ desc: event.target.value })}
        />
        {renderNodeSpecificConfig()}
        <button type="button" onClick={onSave} className="w-full rounded bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-700">保存节点配置</button>
      </div>
    </div>
  )
}
