# 工作流 DSL 说明

本文档描述当前项目工作流 DSL 的**真实结构、节点配置、校验规则与运行语义**。内容以以下实现为准：

- 前端存储态 DSL：`web/components/workflow/dify/core/types.ts`
- 前端默认配置与归一化：`web/components/workflow/dify/core/node-config.ts`
- 前端校验：`web/components/workflow/dify/core/validation.ts`
- 后端运行态解析与执行：`server/internal/workflowruntime/dsl.go`、`server/internal/workflowruntime/executors.go`、`server/internal/workflowruntime/runtime.go`
- 示例：`demo/dsl-2.json`

## 1. DSL 分层

项目里同时存在两种近似 DSL：

- 存储态 `DifyWorkflowDSL`
  - 用于编辑器保存、配置、校验
  - 包含编辑器增强字段：`globalVariables`、`workflowParameters`、`workflowVariableScopes`、`viewport`
- 运行态 `WorkflowDSL`
  - 用于后端执行
  - 只保留执行需要的字段：`nodes`、`edges`、`globalVariables`、`workflowParameters`、`viewport`

前端编辑器维护的是存储态结构；后端执行时按运行态字段解析。`workflowVariableScopes` 仅用于编辑器，不进入后端运行逻辑。

## 2. 根对象结构

最外层是一个 JSON 对象，常见结构如下：

```json
{
  "nodes": [],
  "edges": [],
  "globalVariables": [],
  "workflowParameters": [],
  "workflowVariableScopes": {},
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

### 2.1 顶层字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `nodes` | `array` | 是 | 节点列表，不能为空 |
| `edges` | `array` | 否 | 连线列表，可为空 |
| `globalVariables` | `array` | 否 | 全局变量定义 |
| `workflowParameters` | `array` | 否 | 流程参数定义 |
| `workflowVariableScopes` | `object` | 否 | 编辑器参数类型提示 |
| `viewport` | `object` | 否 | 画布视口，默认 `{x:0,y:0,zoom:1}` |

### 2.2 全局约束

- `nodes` 至少包含一个节点，且必须存在且仅存在一个 `start` 节点。
- 至少存在一个 `end` 节点。
- `edges.source` 与 `edges.target` 必须指向存在的节点。
- 非 `start` 节点允许多入边，但其执行是否等待全部上游由 `joinMode` 控制。
- 非 `end` 节点允许多出边，其后续节点触发顺序由 `fanOutMode` 控制。

## 3. Node / Edge 通用结构

### 3.1 Node

```json
{
  "id": "node-1",
  "type": "custom",
  "position": { "x": 100, "y": 200 },
  "data": {
    "title": "节点标题",
    "desc": "节点说明",
    "type": "llm",
    "config": {}
  }
}
```

关键字段：

- `id`：节点唯一标识
- `type`：固定使用 ReactFlow 节点类型，运行时不关心具体值
- `position`：编辑器坐标，运行时仅做透传
- `data.title`：节点名称
- `data.desc`：节点描述，可为空
- `data.type`：节点类型
- `data.config`：该节点的配置对象

当前支持的 `data.type`：

- `start`
- `input`
- `llm`
- `if-else`
- `iteration`
- `code`
- `http-request`
- `api-request`
- `end`

### 3.2 Edge

```json
{
  "id": "e-1",
  "source": "node-a",
  "target": "node-b",
  "sourceHandle": "if-branch-0"
}
```

关键字段：

- `id`：连线唯一标识
- `source`：源节点 ID
- `target`：目标节点 ID
- `sourceHandle`：可选，主要用于 `if-else` 分支出口

`if-else` 的 `sourceHandle` 约定：

- 条件分支：`if-branch-0`、`if-branch-1`、...
- 兜底分支：`if-else`

## 4. 变量模型与引用规则

### 4.1 变量来源

运行时变量表本质上是一个 `map[string]any`：

- 启动输入写入顶层变量
- 节点执行成功后，节点输出写入 `variables[nodeId]`
- 写回映射可把节点输出再次写到 `workflow.xxx`、`global.xxx` 或其他目标路径

常见变量根：

- `start.xxx`：开始节点参数
- `workflow.xxx`：流程参数/流程级写回结果
- `global.xxx`：全局变量
- `user.xxx`：用户保留变量
- `节点ID.xxx`：节点输出

### 4.2 引用格式

- 模板替换：`{{path.to.value}}`
- 完整值解析：`{{path.to.value}}` 或 `path.to.value`
- 数组与对象路径支持点路径风格，例如 `workflow.entp.name`

常见示例：

```json
"{{start.entpname}}"
"{{workflow.entp.actualController}}"
"Bearer {{workflow.token}}"
```

解析规则：

- 模板字符串中解析不到的变量会被视为空字符串或缺失值
- `if-else`、`end.output.source`、`api-request.paramValues` 等位置会走“按路径解析”
- `code` 节点模板会把变量渲染成对应语言的字面量，而不是简单字符串替换

### 4.3 写回映射 `writebackMappings`

适用于 `llm`、`code`、`http-request`、`api-request`。

标准结构：

```json
{
  "expression": "data.id",
  "targetPath": "workflow.entpId"
}
```

字段说明：

- `expression`：源表达式，当前以 JSONata/路径表达式语义消费
- `targetPath`：写回目标路径；为空时表示返回一组 writebacks
- `mode`：可选，通常无需手填；有 `targetPath` 时会被归一化为 `value`
- `sourcePath`：历史兼容字段，旧 DSL 仍可读
- `arrayMapping`：编辑器生成的数组/对象映射元信息

约束：

- `expression` 不能为空
- 写回目标通常写入 `workflow.xxx` 或 `global.xxx`
- 映射是否合法由前端校验与后端执行共同约束

## 5. 通用控制字段

### 5.1 `joinMode`

适用于多入边节点，值：

- `all`：等待全部上游到达后执行，默认值
- `any`：任一上游到达即可执行

默认值：

- `end` 默认 `all`
- 其他支持该字段的节点默认 `all`

### 5.2 `fanOutMode`

适用于多出边节点，值：

- `sequential`：顺序触发下游，默认值
- `parallel`：并行触发下游

默认值：

- `start`、`input`、`llm`、`if-else`、`iteration`、`code`、`http-request`、`api-request` 默认 `sequential`

### 5.3 `retryCount`

仅以下节点生效：

- `llm`
- `http-request`
- `api-request`

规则：

- 默认值 `0`
- 未配置时按 `0` 处理
- 必须是大于等于 `0` 的整数
- 后端支持失败后自动重试，并产生 `node.retrying` 事件

## 6. 顶层参数定义

### 6.1 `globalVariables`

单项结构：

```json
{
  "name": "token",
  "valueType": "string",
  "defaultValue": "",
  "description": "全局 Token"
}
```

字段：

- `name`：变量名
- `valueType`：`string | number | boolean | array | object`
- `defaultValue`：默认值，字符串形式存储
- `json`：当 `valueType` 为 `object`/`array` 时可提供 JSON 示例
- `description`：说明
- `jsonSchema`：后端兼容旧字段，当前不建议新 DSL 再写

### 6.2 `workflowParameters`

单项结构：

```json
{
  "name": "entp",
  "label": "企业信息",
  "valueType": "object",
  "required": false,
  "defaultValue": "{}",
  "json": "{\"name\":\"\"}",
  "description": "流程级企业对象"
}
```

额外约束：

- `name` 与 `label` 不能为空
- 同层不能重名
- `valueType` 为 `object` / `array` 时，`defaultValue` 与 `json` 要能通过校验

## 7. 节点配置详解

以下各节均描述 `node.data.config`。

### 7.1 `start` 开始节点

用途：定义流程启动时的输入参数。

默认配置：

```json
{
  "fanOutMode": "sequential",
  "variables": [
    { "name": "query", "label": "用户输入", "type": "text-input", "required": true }
  ]
}
```

字段：

- `fanOutMode`：`parallel | sequential`
- `variables`：输入参数数组

`variables[]` 字段：

- `name`：参数名，必填
- `label`：展示名，必填
- `type`：`text-input | paragraph | select | number | checkbox | file | file-list | json_object`
- `required`：是否必填
- `placeholder`：占位提示
- `defaultValue`：默认值
- `maxLength`：文本长度上限
- `min` / `max` / `step`：数字限制
- `fileTypes`：允许文件类型
- `maxFiles`：最大文件数
- `jsonSchema`：`json_object` 历史兼容配置
- `multiSelect`：仅 `select` 使用
- `visibleWhen` / `validateWhen`：可见/校验表达式
- `options`：仅 `select` 使用

校验规则：

- 至少存在一个变量
- `name` 与 `label` 不能为空
- 变量名不能重复
- `select` 至少有一个选项
- `select.options[].label` 与 `value` 不能为空
- 同一 `select` 内选项编码不能重复

### 7.2 `input` 人工输入节点

用途：执行中暂停，等待人工补充字段。

默认配置：

```json
{
  "joinMode": "all",
  "fanOutMode": "sequential",
  "prompt": "",
  "fields": [
    { "name": "input", "label": "输入内容", "type": "text", "required": true, "options": [], "defaultValue": "" }
  ]
}
```

字段：

- `joinMode`
- `fanOutMode`
- `prompt`：等待输入时的提示文案
- `fields`：字段数组

`fields[]` 字段：

- `name`
- `label`
- `type`：`text | paragraph | number | select | checkbox`
- `required`
- `options`
- `defaultValue`
- `visibleWhen`
- `validateWhen`

运行语义：

- 第一次执行若缺少输入，会进入 `waiting_input`
- 后端返回 `waitingInput.schema`
- 恢复执行时会做后端字段校验与归一化

校验规则：

- 至少存在一个字段
- `name`、`label` 不能为空
- 字段名不能重复
- `select` 必须配置合法选项

### 7.3 `llm` 大模型节点

用途：调用模型生成字符串或 JSON 输出。

默认配置：

```json
{
  "joinMode": "all",
  "fanOutMode": "sequential",
  "retryCount": 0,
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "maxTokens": 1024,
  "systemPrompt": "你是一个有帮助的助手。",
  "userPrompt": "{{query}}",
  "contextEnabled": false,
  "outputType": "string",
  "outputVar": "result",
  "writebackMappings": []
}
```

字段：

- `joinMode`
- `fanOutMode`
- `retryCount`
- `model`
- `temperature`
- `maxTokens`
- `systemPrompt`
- `userPrompt`
- `contextEnabled`
- `outputType`：`string | json`
- `outputVar`
- `writebackMappings`

运行语义：

- `systemPrompt`、`userPrompt` 会先做模板变量渲染
- `outputType=json` 时会尝试解析模型结果为 JSON
- 节点主输出会挂到 `变量[nodeId][outputVar]`
- 若配置了 `writebackMappings`，会把输出继续写回目标路径

校验规则：

- `retryCount` 必须是 `>=0` 整数
- `model` 不能为空
- `systemPrompt` 和 `userPrompt` 不能同时为空
- `outputVar` 不能为空
- `outputType=json` 时，`writebackMappings` 会按 JSON 映射校验

### 7.4 `if-else` 条件节点

用途：根据条件选择分支。

默认配置：

```json
{
  "joinMode": "all",
  "fanOutMode": "sequential",
  "conditions": [
    { "name": "分支1", "left": "query", "operator": "contains", "right": "" }
  ],
  "elseBranchName": "else"
}
```

字段：

- `joinMode`
- `fanOutMode`
- `conditions`
- `elseBranchName`

`conditions[]` 字段：

- `name`：分支名称
- `left`：左值
- `operator`：`contains | not_contains | eq | neq | gt | lt | empty | not_empty`
- `right`：右值

运行语义：

- 条件按数组顺序依次判断，命中第一条后走对应出口
- 未命中时走 `else`
- 后端会产生 `node.branch` 事件

校验规则：

- 分支名称不能为空且不能重复
- `elseBranchName` 不能为空
- `left` 不能为空
- 非 `empty` / `not_empty` 运算符时，`right` 不能为空
- 建议每个条件分支和 `else` 分支都连接下游

### 7.5 `iteration` 迭代节点

用途：对输入集合逐项执行子流程。

默认配置：

```json
{
  "joinMode": "all",
  "fanOutMode": "sequential",
  "iteratorSource": "",
  "outputSource": "",
  "outputVar": "results",
  "itemVar": "item",
  "indexVar": "index",
  "isParallel": false,
  "parallelNums": 10,
  "errorHandleMode": "terminated",
  "flattenOutput": true,
  "children": { "nodes": [{ "id": "iter-start", "data": { "type": "start" } }], "edges": [], "viewport": { "x": 0, "y": 0, "zoom": 1 } }
}
```

字段：

- `joinMode`
- `fanOutMode`
- `iteratorSource`：迭代输入集合
- `outputSource`：子流程中作为单项输出来源的变量
- `outputVar`：最终汇总输出变量名
- `itemVar`：单项变量名，默认 `item`
- `indexVar`：索引变量名，默认 `index`
- `isParallel`
- `parallelNums`
- `errorHandleMode`：`terminated | continue-on-error | remove-abnormal-output`
- `flattenOutput`
- `children`：子流程 DSL（主画布内区域化编辑）

校验规则：

- `iteratorSource`、`outputSource`、`outputVar` 不能为空
- `isParallel=true` 时，`parallelNums` 必须在 `1..100`
- `children.nodes` 为空时给 warning

说明：

- `children` 是一个嵌套的小型 DSL，仅用于迭代内部执行
- 子流程默认会带一个迭代开始节点，但该入口节点不承载表单配置
- 迭代输入数组统一由父迭代节点的 `iteratorSource` 选择
- 仅当前循环区域内的节点可使用 `itemVar` / `indexVar`

### 7.6 `code` 代码节点

用途：运行 JavaScript 或 Python 代码并输出结果。

默认配置：

```json
{
  "joinMode": "all",
  "fanOutMode": "sequential",
  "language": "javascript",
  "code": "function main(input) {\n  return { result: {{start.input}} }\n}",
  "outputSchema": "",
  "writebackMappings": [],
  "outputs": ["result"]
}
```

字段：

- `joinMode`
- `fanOutMode`
- `language`：`javascript | python3`
- `code`
- `outputSchema`：历史兼容字段，当前可保留但不建议依赖
- `writebackMappings`
- `outputs`：输出变量名列表

运行语义：

- `code` 中的模板变量会先渲染成目标语言字面量
- 运行结果对象会按 `outputs` 与返回值写出
- `writebackMappings` 可把返回结果写回目标路径

校验规则：

- `code` 不能为空
- `outputs` 至少有一个元素
- `outputs` 不能重复

### 7.7 `http-request` HTTP 请求节点

用途：直接发起外部 HTTP 请求。

默认配置：

```json
{
  "joinMode": "all",
  "fanOutMode": "sequential",
  "retryCount": 0,
  "method": "GET",
  "url": "",
  "query": [],
  "headers": [],
  "bodyType": "none",
  "body": "",
  "timeout": 30,
  "authorization": {
    "type": "none",
    "apiKey": "",
    "header": "Authorization"
  },
  "outputSchema": "",
  "writebackMappings": []
}
```

字段：

- `joinMode`
- `fanOutMode`
- `retryCount`
- `method`：`GET | POST | PUT | PATCH | DELETE`
- `url`
- `query[]`
- `headers[]`
- `bodyType`：`none | json | raw | x-www-form-urlencoded | form-data`
- `body`
- `timeout`
- `authorization`
- `outputSchema`：历史兼容字段
- `writebackMappings`

`authorization`：

- `type`：`none | bearer | api-key`
- `apiKey`
- `header`

运行语义：

- `url`、`query.value`、`headers.value`、`body` 会做模板渲染
- 请求结果通常包含 `status`、`ok`、`body`、`raw`
- `writebackMappings` 基于响应对象执行

校验规则：

- `retryCount` 必须合法
- `url` 不能为空
- `query` / `headers` 中如果填写了值，必须填写 `key`

### 7.8 `api-request` 后端 API 请求节点

用途：调用项目后端登记过的业务 API 路由。

默认配置：

```json
{
  "joinMode": "all",
  "fanOutMode": "sequential",
  "retryCount": 0,
  "route": { "method": "GET", "path": "" },
  "params": [],
  "paramValues": [],
  "timeout": 30,
  "successStatusCode": 200,
  "writebackMappings": []
}
```

字段：

- `joinMode`
- `fanOutMode`
- `retryCount`
- `route.method`
- `route.path`
- `params`
- `paramValues`
- `timeout`
- `successStatusCode`
- `writebackMappings`

`params[]` 定义接口参数元信息：

- `name`
- `in`：`path | query | body`
- `type`
- `description`
- `validation.required`
- `validation.enum`
- `validation.min`
- `validation.max`
- `validation.pattern`

`paramValues[]`：

- `name`
- `in`
- `value`

运行语义：

- `route` 指向后端接口
- `paramValues` 中的 `value` 支持变量路径/模板
- 后端会按 `path/query/body` 分别组装请求
- 成功响应会生成标准输出对象，并支持 `writebackMappings`

校验规则：

- `retryCount` 必须合法
- `route.path` 不能为空
- `params` 中声明为必填的参数，在 `paramValues` 中必须有值

### 7.9 `end` 结束节点

用途：汇总流程最终输出。

默认配置：

```json
{
  "joinMode": "all",
  "outputs": [
    { "name": "result", "source": "llm.text" }
  ]
}
```

字段：

- `joinMode`
- `outputs`
- `templateId`

`outputs[]`：

- `name`：输出名
- `source`：来源变量路径或模板

运行语义：

- 若 `outputs` 为空，后端会回传当前变量表
- 否则按 `source` 解析并组装最终输出

校验规则：

- `outputs` 至少存在一个项
- 每个输出的 `name` 与 `source` 都不能为空

## 8. 运行时行为补充

### 8.1 节点状态

- `pending`
- `running`
- `waiting_input`
- `succeeded`
- `failed`
- `skipped`

### 8.2 关键事件

- `node.started`
- `node.waiting_input`
- `node.resumed`
- `node.retrying`
- `node.succeeded`
- `node.failed`
- `node.finished`
- `node.skipped`
- `node.branch`

### 8.3 重试规则

- 仅 `llm` / `http-request` / `api-request` 支持
- `maxAttempts = 1 + retryCount`
- 单次成功即停止重试
- 失败且仍可重试时会产生 `node.retrying`

## 9. `demo/dsl-2.json` 对应示例

`demo/dsl-2.json` 覆盖了本项目最典型的配置方式：

- `start`：录入 `entpname`
- `api-request`：按企业简称查询企业并写回 `workflow.entp`
- `input`：人工确认是否重新拉取
- `if-else`：根据 `workflow.entp` 是否为空分支
- `http-request`：调用外部服务并写回流程变量
- `end`：输出 `workflow.entp`、`workflow.score`、`workflow.scoreTotal`

建议新增 DSL 时优先参考该文件的字段组织方式，而不是历史文档中的旧字段。

## 10. 常见注意事项

- `retryCount` 不配就是 `0`，不会重试。
- `workflowVariableScopes` 只影响编辑器，不参与后端执行。
- `outputSchema`、`jsonSchema` 属于兼容字段，当前新 DSL 不建议继续依赖。
- `if-else` 分支是否真正可达，除了条件配置，还取决于 `edges.sourceHandle` 是否正确。
- `joinMode=any` 会让多入边节点提前执行，适合汇总/结束类场景；默认仍建议用 `all`。
- `fanOutMode=parallel` 会并发触发多个下游，适用于互不依赖的分支。
