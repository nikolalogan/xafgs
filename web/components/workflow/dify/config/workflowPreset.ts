import CustomEdge from '../components/CustomEdge'
import CustomNode from '../components/CustomNode'
import { CUSTOM_EDGE, CUSTOM_NODE } from '../core/constants'
import { defaultGlobalVariables } from '../core/global-variables'
import { defaultWorkflowParameters } from '../core/workflow-parameters'
import { BlockEnum, type DifyWorkflowDSL } from '../core/types'
import { buildIfElseBranchHandleId, IF_ELSE_FALLBACK_HANDLE } from '@/lib/workflow-ifelse'

export const demoDSL: DifyWorkflowDSL = {
  nodes: [
    {
      id: 'start',
      type: CUSTOM_NODE,
      position: { x: 80, y: 260 },
      data: {
        title: '开始',
        desc: '工作流入口',
        type: BlockEnum.Start,
        config: {
          variables: [
            { name: 'query', label: '用户问题', type: 'text-input', required: true, placeholder: '请输入问题' },
            { name: 'scene', label: '场景', type: 'select', required: true, options: [{ label: '通用', value: 'general' }, { label: '客服', value: 'support' }] },
          ],
        },
      },
    },
    {
      id: 'input-1',
      type: CUSTOM_NODE,
      position: { x: 340, y: 260 },
      data: {
        title: '输入',
        desc: '补充业务字段',
        type: BlockEnum.Input,
        config: {
          fields: [
            { name: 'customer_name', label: '客户名称', type: 'text', required: true, options: [], defaultValue: '' },
            {
              name: 'priority',
              label: '优先级',
              type: 'select',
              required: true,
              options: [
                { label: 'high', value: 'high' },
                { label: 'normal', value: 'normal' },
                { label: 'low', value: 'low' },
              ],
              defaultValue: 'normal',
            },
          ],
        },
      },
    },
    {
      id: 'llm-1',
      type: CUSTOM_NODE,
      position: { x: 600, y: 260 },
      data: {
        title: 'LLM',
        desc: '理解用户意图',
        type: BlockEnum.LLM,
        config: {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          maxTokens: 512,
          systemPrompt: '你是一个工作流路由助手。',
          userPrompt: '问题：{{start.query}}\n场景：{{start.scene}}\n优先级：{{input-1.priority}}',
          contextEnabled: false,
          outputType: 'string',
          outputVar: 'result',
          writebackMappings: [],
        },
      },
    },
    {
      id: 'if-1',
      type: CUSTOM_NODE,
      position: { x: 860, y: 260 },
      data: {
        title: '条件分支',
        desc: '分流不同处理路径',
        type: BlockEnum.IfElse,
        config: {
          conditions: [
            { name: '需要外部接口', left: '{{llm-1.text}}', operator: 'contains', right: 'API' },
          ],
          elseBranchName: '默认分支',
        },
      },
    },
    {
      id: 'http-1',
      type: CUSTOM_NODE,
      position: { x: 1120, y: 120 },
      data: {
        title: 'HTTP',
        desc: '调用外部服务',
        type: BlockEnum.HttpRequest,
        config: {
          method: 'GET',
          url: 'https://api.example.com/search',
          query: [{ key: 'q', value: '{{start.query}}' }],
          headers: [{ key: 'X-Request-Id', value: '{{global.workflow_run_id}}' }],
          bodyType: 'none',
          body: '',
          timeout: 30,
          authorization: { type: 'none', apiKey: '', header: 'Authorization' },
          outputSchema: '{\n  "type": "object",\n  "properties": {\n    "data": {\n      "type": "object",\n      "properties": {\n        "answer": { "type": "string" }\n      }\n    }\n  }\n}',
          writebackMappings: [{ expression: 'data.answer', targetPath: 'global.session.tenant.id' }],
        },
      },
    },
    {
      id: 'code-1',
      type: CUSTOM_NODE,
      position: { x: 1120, y: 400 },
      data: {
        title: '代码',
        desc: '后处理文本',
        type: BlockEnum.Code,
        config: {
          language: 'javascript',
          code: 'function main(input) {\n  const text = String(input?.text || input || \'\')\n  return { result: text.trim() }\n}',
          outputSchema: '{\n  "type": "object",\n  "properties": {\n    "result": { "type": "string" }\n  }\n}',
          writebackMappings: [{ expression: 'result', targetPath: 'workflow.query' }],
          outputs: ['result'],
        },
      },
    },
    {
      id: 'iteration-1',
      type: CUSTOM_NODE,
      position: { x: 1380, y: 260 },
      data: {
        title: '迭代',
        desc: '遍历候选项',
        type: BlockEnum.Iteration,
        config: {
          iteratorSource: '{{workflow.items}}',
          outputSource: '{{iteration-1.item}}',
          outputVar: 'results',
          itemVar: 'item',
          indexVar: 'index',
          isParallel: false,
          parallelNums: 10,
          errorHandleMode: 'terminated',
          flattenOutput: true,
          children: {
            nodes: [
              {
                id: 'iter-start',
                type: 'childNode',
                position: { x: 36, y: 40 },
                data: {
                  title: '迭代开始',
                  desc: '迭代子流程入口',
                  type: BlockEnum.Start,
                  config: { variables: [{ name: 'item', label: '当前项', type: 'text-input', required: false }] },
                },
              },
              {
                id: 'iter-code',
                type: 'childNode',
                position: { x: 320, y: 40 },
                data: {
                  title: '子代码处理',
                  desc: '处理当前 item',
                  type: BlockEnum.Code,
                  config: {
                    language: 'javascript',
                    code: 'function main(input) {\n  const value = input?.item ?? input\n  return { result: String(value) }\n}',
                    outputSchema: '',
                    writebackMappings: [],
                    outputs: ['result'],
                  },
                },
              },
            ],
            edges: [
              {
                id: 'iter-edge-1',
                source: 'iter-start',
                target: 'iter-code',
                type: CUSTOM_EDGE,
              },
            ],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        },
      },
    },
    {
      id: 'end',
      type: CUSTOM_NODE,
      position: { x: 1640, y: 260 },
      data: {
        title: '结束',
        desc: '聚合输出',
        type: BlockEnum.End,
        config: {
          outputs: [
            { name: 'result', source: '{{code-1.result}}' },
            { name: 'http_answer', source: '{{http-1.text}}' },
            { name: 'iter_results', source: '{{iteration-1.results}}' },
          ],
        },
      },
    },
  ],
  edges: [
    { id: 'e-start-input', source: 'start', target: 'input-1', type: CUSTOM_EDGE },
    { id: 'e-input-llm', source: 'input-1', target: 'llm-1', type: CUSTOM_EDGE },
    { id: 'e-llm-if', source: 'llm-1', target: 'if-1', type: CUSTOM_EDGE },
    { id: 'e-if-http', source: 'if-1', sourceHandle: buildIfElseBranchHandleId(0), target: 'http-1', type: CUSTOM_EDGE },
    { id: 'e-if-code', source: 'if-1', sourceHandle: IF_ELSE_FALLBACK_HANDLE, target: 'code-1', type: CUSTOM_EDGE },
    { id: 'e-http-iter', source: 'http-1', target: 'iteration-1', type: CUSTOM_EDGE },
    { id: 'e-code-iter', source: 'code-1', target: 'iteration-1', type: CUSTOM_EDGE },
    { id: 'e-iter-end', source: 'iteration-1', target: 'end', type: CUSTOM_EDGE },
  ],
  globalVariables: [
    ...defaultGlobalVariables,
    {
      name: 'session',
      valueType: 'object',
      defaultValue: '{\"tenant\":{\"id\":\"t_001\"},\"env\":\"dev\"}',
      json: '{\"tenant\":{\"id\":\"t_001\"},\"env\":\"dev\"}',
      description: '会话上下文',
    },
  ],
  workflowParameters: [
    ...defaultWorkflowParameters,
    {
      name: 'items',
      label: '待迭代列表',
      valueType: 'array',
      required: false,
      defaultValue: '[\"a\",\"b\"]',
      json: '[\"a\",\"b\"]',
      description: '迭代节点输入',
    },
  ],
  workflowVariableScopes: {},
  viewport: { x: -40, y: -40, zoom: 0.68 },
}

export const nodeTypeLabel: Record<BlockEnum, string> = {
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

export const nodeTypes = {
  [CUSTOM_NODE]: CustomNode,
}

export const edgeTypes = {
  [CUSTOM_EDGE]: CustomEdge,
}
