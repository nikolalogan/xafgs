# 工作流运行时（后端执行）

本目录描述“工作流执行（executions）”在 **Go 后端**的运行时行为：节点状态、节点事件、等待输入与表单校验、以及日志输出约定。

## 1. 节点状态（nodeStates）

节点运行状态（`nodeStates[nodeId].status`）：

- `pending`：未开始
- `running`：执行中
- `waiting_input`：等待人工输入（仅 `input` 节点会进入）
- `succeeded`：成功
- `failed`：失败
- `skipped`：跳过（分支未命中/不可达，execution 收尾时由 `pending` 统一转为 `skipped`）

实现位置：`server/internal/workflowruntime/runtime.go`

## 2. 节点事件（events）

后端会把节点生命周期事件追加到 `execution.events`，用于前端渲染执行轨迹与调试：

- `node.started`：节点进入 `running`
- `node.waiting_input`：节点进入 `waiting_input`
- `node.resumed`：waiting_input 节点在 `resume` 后再次开始执行
- `node.retrying`：节点失败后准备再次执行（仅 `llm` / `http-request` / `api-request` 且 `retryCount > 0`）
- `node.succeeded`：节点成功完成
- `node.failed`：节点失败
- `node.finished`：节点本轮生命周期结束，`payload.status` 为 `succeeded | failed | waiting_input`
- `node.skipped`：节点被标记跳过（execution 收尾）
- `node.branch`：If-Else 选择分支（包含 `handleId/branchName`）

实现位置：`server/internal/workflowruntime/runtime.go`

前端推荐消费方式：

- 收到 `node.started` 时，进入当前节点并渲染节点内容
- 收到 `node.finished` 时，立即退出当前节点
- 收到下一条 `node.started` 时，再切换并渲染下一个节点内容

其中 `node.finished.payload` 约定包含：

- `nodeId`
- `status`
- `endedAt`
- `error`（仅失败时存在）

`node.retrying.payload` 约定包含：

- `nodeId`
- `attempt`：即将开始的第几次尝试
- `maxAttempts`：最大尝试次数（`1 + retryCount`）
- `error`：上一次失败原因

## 3. waiting_input 的表单渲染与校验

### 3.1 表单 schema

当 `input` 节点第一次执行且缺少 `nodeInput` 时，后端会返回：

- `execution.status = waiting_input`
- `execution.waitingInput = { nodeId, nodeTitle, schema }`

其中 `schema.fields` 来自 `input` 节点 `config.fields`，由后端归一化生成。

实现位置：`server/internal/workflowruntime/executors.go`

### 3.2 双校验（前端 + 后端）

为保证一致性与安全性，表单需要双校验：

- 前端：提交前校验 required/number/select（体验优先）
- 后端：Start/Resume 入参再次校验（最终裁决）

后端校验规则与归一化逻辑在：`server/internal/workflowruntime/fields.go`

## 4. 后端日志（workflow_log）

后端运行时会输出结构化 JSON 日志：

- `type = "workflow_log"`
- `event`：如 `node.started`、`node.succeeded`、`execution.resumed` 等
- `attempt/maxAttempts`：重试节点的尝试次数信息（适用于 `node.retrying`、`node.succeeded`、`node.failed`）
- `requestId/executionId/nodeId`：尽可能补齐
- `durationMs`：节点耗时（仅 succeeded/failed）

实现位置：`server/internal/workflowruntime/log.go`
