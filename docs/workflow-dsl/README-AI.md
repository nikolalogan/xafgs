# 工作流 DSL 生成约束

本文档仅用于**生成/校验 DSL**，不解释实现细节。生成 DSL 时只需遵守本文规则。

## 1. 根结构

DSL 根节点必须是对象，允许字段：

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

约束：

- `nodes` 必填且不能为空
- 必须存在且仅存在一个 `start` 节点
- 至少存在一个 `end` 节点
- `edges` 中的 `source`、`target` 必须引用已存在节点

## 2. 节点与连线

### 2.1 节点类型

只允许：

- `start`
- `input`
- `llm`
- `if-else`
- `iteration`
- `code`
- `http-request`
- `api-request`
- `end`

### 2.2 节点通用结构

```json
{
  "id": "node-id",
  "type": "custom",
  "position": { "x": 0, "y": 0 },
  "data": {
    "title": "节点标题",
    "desc": "节点说明",
    "type": "llm",
    "config": {}
  }
}
```

要求：

- `id` 必填且唯一
- `data.title` 必填
- `data.type` 必填且必须是允许枚举之一
- `data.config` 必须是对象

### 2.3 连线结构

```json
{
  "id": "edge-id",
  "source": "node-a",
  "target": "node-b",
  "sourceHandle": "if-branch-0"
}
```

要求：

- `id`、`source`、`target` 必填
- `if-else` 出边必须使用正确的 `sourceHandle`
  - 条件分支：`if-branch-0`、`if-branch-1`、...
  - 兜底分支：`if-else`

## 3. 通用配置规则

### 3.1 通用控制字段

- `joinMode`：`all | any`
- `fanOutMode`：`parallel | sequential`
- `retryCount`：仅 `llm` / `http-request` / `api-request` 允许，必须是 `>= 0` 的整数

默认约定：

- `joinMode` 默认 `all`
- `fanOutMode` 默认 `sequential`
- `retryCount` 默认 `0`

### 3.2 变量引用

变量引用统一使用：

```json
"{{start.query}}"
"{{workflow.entp.name}}"
"{{node-1.result}}"
```

允许引用：

- `start.xxx`
- `workflow.xxx`
- `global.xxx`
- `user.xxx`（例如 `user.username`、`user.warningAccount`）
- `节点ID.xxx`

### 3.3 写回映射

适用节点：

- `llm`
- `code`
- `http-request`
- `api-request`

推荐结构：

```json
{
  "expression": "data.id",
  "targetPath": "workflow.entpId"
}
```

要求：

- `expression` 必填
- `targetPath` 推荐写入 `workflow.xxx` 或 `global.xxx`
- 旧字段 `sourcePath` 可兼容，但新 DSL 优先使用 `expression`

## 4. 各节点配置约束

### 4.1 `start`

```json
{
  "fanOutMode": "sequential",
  "variables": []
}
```

`variables[]` 允许字段：

- `name`
- `label`
- `type`
- `required`
- `placeholder`
- `defaultValue`
- `maxLength`
- `min`
- `max`
- `step`
- `fileTypes`
- `maxFiles`
- `jsonSchema`
- `multiSelect`
- `visibleWhen`
- `validateWhen`
- `options`

`type` 只允许：

- `text-input`
- `paragraph`
- `select`
- `number`
- `checkbox`
- `file`
- `file-list`
- `json_object`

约束：

- `variables` 至少一个
- 每项 `name`、`label` 必填
- `name` 不能重复
- `select` 类型必须提供非空 `options`
- `options[].label` 与 `options[].value` 必填

### 4.2 `input`

```json
{
  "joinMode": "all",
  "fanOutMode": "sequential",
  "prompt": "",
  "fields": []
}
```

`fields[]` 允许字段：

- `name`
- `label`
- `type`
- `required`
- `options`
- `defaultValue`
- `visibleWhen`
- `validateWhen`

`type` 只允许：

- `text`
- `paragraph`
- `number`
- `select`
- `checkbox`

约束：

- `fields` 至少一个
- 每项 `name`、`label` 必填
- `name` 不能重复
- `select` 类型必须提供合法 `options`

### 4.3 `llm`

必需字段：

- `model`
- `outputVar`

允许字段：

- `joinMode`
- `fanOutMode`
- `retryCount`
- `model`
- `temperature`
- `maxTokens`
- `systemPrompt`
- `userPrompt`
- `contextEnabled`
- `outputType`
- `outputVar`
- `writebackMappings`

约束：

- `outputType` 只允许 `string | json`
- `systemPrompt` 与 `userPrompt` 不能同时为空
- `retryCount` 必须合法

### 4.4 `if-else`

允许字段：

- `joinMode`
- `fanOutMode`
- `conditions`
- `elseBranchName`

`conditions[]` 必须包含：

- `name`
- `left`
- `operator`
- `right`

`operator` 只允许：

- `contains`
- `not_contains`
- `eq`
- `neq`
- `gt`
- `lt`
- `empty`
- `not_empty`

约束：

- 至少一个条件
- `name` 不能为空且不能重复
- `left` 必填
- `elseBranchName` 必填
- 非 `empty` / `not_empty` 时 `right` 必填

### 4.5 `iteration`

允许字段：

- `joinMode`
- `fanOutMode`
- `iteratorSource`
- `outputVar`
- `itemVar`
- `indexVar`
- `isParallel`
- `parallelNums`
- `errorHandleMode`
- `flattenOutput`
- `children`

约束：

- `iteratorSource`、`outputVar` 必填
- `errorHandleMode` 只允许 `terminated | continue-on-error | remove-abnormal-output`
- `isParallel=true` 时，`parallelNums` 必须在 `1..100`
- `children` 必须是一个合法子 DSL，至少包含 `nodes`

### 4.6 `code`

允许字段：

- `joinMode`
- `fanOutMode`
- `language`
- `code`
- `outputSchema`
- `writebackMappings`
- `outputs`

约束：

- `language` 只允许 `javascript | python3`
- `code` 必填
- `outputs` 至少一个
- `outputs` 不能重复

### 4.7 `http-request`

允许字段：

- `joinMode`
- `fanOutMode`
- `retryCount`
- `method`
- `url`
- `query`
- `headers`
- `bodyType`
- `body`
- `timeout`
- `authorization`
- `outputSchema`
- `writebackMappings`

约束：

- `method` 只允许 `GET | POST | PUT | PATCH | DELETE`
- `url` 必填
- `bodyType` 只允许 `none | json | raw | x-www-form-urlencoded | form-data`
- `authorization.type` 只允许 `none | bearer | api-key`
- `retryCount` 必须合法
- `query[]`、`headers[]` 中若有 `value`，则 `key` 不能为空

### 4.8 `api-request`

允许字段：

- `joinMode`
- `fanOutMode`
- `retryCount`
- `route`
- `params`
- `paramValues`
- `timeout`
- `successStatusCode`
- `writebackMappings`

`route` 必须包含：

- `method`
- `path`

`params[]` 允许字段：

- `name`
- `in`
- `type`
- `description`
- `validation`

`in` 只允许：

- `path`
- `query`
- `body`

约束：

- `route.path` 必填
- `retryCount` 必须合法
- `params` 中标记 `validation.required=true` 的参数，必须在 `paramValues` 里配置非空值

### 4.9 `end`

允许字段：

- `joinMode`
- `outputs`
- `templateId`

`outputs[]` 必须包含：

- `name`
- `source`

约束：

- `outputs` 至少一个
- 每项 `name`、`source` 必填

## 5. 禁止项

生成 DSL 时禁止：

- 缺少 `start` 或缺少 `end`
- 多个 `start`
- 节点 ID 重复
- 节点类型不在允许列表中
- `if-else` 分支未使用合法 `sourceHandle`
- `retryCount` 使用负数、小数或字符串垃圾值
- `select` 字段没有选项
- `code.outputs` 为空或重复
- `api-request.route.path` 为空
- `end.outputs` 为空
- 把展示文案写成变量值；变量必须写成真实路径，例如 `{{workflow.entp.name}}`

## 6. 推荐生成策略

- 优先生成最小合法 DSL，再补充可选字段。
- 新 DSL 优先使用 `expression`，不要新增依赖 `sourcePath`、`jsonSchema`、`outputSchema` 这类兼容字段。
- 节点说明 `data.desc` 推荐写清输入来源、核心行为和写回目标。
- 需要流程级共享数据时优先写回到 `workflow.xxx`。
