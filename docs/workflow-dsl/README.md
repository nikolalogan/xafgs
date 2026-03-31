# 工作流 DSL 编写规则（README）

本文档说明本项目中“工作流 DSL”的**数据结构**、**变量解析规则**、**各节点配置字段**与**运行时行为**，用于手写/生成 DSL、排查运行结果与节点输出不一致等问题。

> 约定：本文所说的 “DSL” 均指 JSON（对象或 JSON 字符串）。

## 1. 两种 DSL（存储态 vs 运行态）

项目里存在两套非常接近的 DSL：

1) **存储态 DSL（Dify 风格）**：用于后台保存/编辑的 DSL，类型为 `DifyWorkflowDSL`  
文件：`web/components/workflow/dify/core/types.ts`

2) **运行态 DSL（Runtime 风格）**：用于运行引擎（`/workflow-api/executions`）启动执行的 DSL，类型为 `WorkflowDSL`  
文件：`web/lib/workflow-types.ts`、`web/lib/workflow-dsl.ts`

实际运行时，前端会将 Dify 风格节点/边“整理成运行态 DSL”并提交给运行 API。

## 2. 根对象结构

### 2.1 运行态 `WorkflowDSL`

最小结构：

```json
{
  "nodes": [],
  "edges": [],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

解析规则：
- `nodes` 必填且不能为空；节点会按 `id/data/position` 做最小校验。见 `web/lib/workflow-dsl.ts`
- `edges` 可为空；边会按 `id/source/target` 做最小校验。见 `web/lib/workflow-dsl.ts`

### 2.2 存储态 `DifyWorkflowDSL`

在 `nodes/edges/viewport` 之外，还可以包含：
- `globalVariables?: []`
- `workflowParameters?: []`
- `workflowVariableScopes?: { [key: string]: "all" | ... }`

这些更多用于编辑器/校验（例如运行前校验），不一定直接影响运行结果。见 `web/components/workflow/dify/core/dsl.ts`

## 3. Node/Edge 的通用字段

本项目沿用 ReactFlow 的 Node/Edge 形态，允许存在大量 UI 字段，但运行/解析只关心关键字段。

### 3.1 Node（节点）

关键字段（必须满足最小校验）：
- `id: string`：节点唯一 ID（强烈建议稳定且可读，如 `start-1` / `end-1`）
- `position: { x: number, y: number }`
- `data: { title: string, type: string, config?: object }`

其中 `data.type` 为节点类型（见下文“节点类型与 config”）。

### 3.2 Edge（连线）

关键字段：
- `id: string`
- `source: string`：源节点 id
- `target: string`：目标节点 id
- `sourceHandle?: string`：分支/端口选择（If-Else 分支依赖这个字段）

## 4. 运行时变量模型（非常重要）

运行引擎维护一个“全局变量表” `variables: Record<string, unknown>`，其规则如下：

1) **启动输入**：执行开始时，`variables = input`（来自开始表单/调用参数）。见 `web/lib/workflow-runtime/xstate-runtime.ts`
2) **节点输出**：每个节点执行成功后，会写入 `variables[nodeId] = output`。见 `web/lib/workflow-runtime/xstate-runtime.ts`
3) **写回（writebacks）**：部分节点（如 HTTP/Code）支持把输出按路径写回到全局变量（可写入任意层级路径）。见 `web/lib/workflow-runtime/xstate-runtime.ts`、`web/lib/workflow-runtime/executors.ts`

因此在 DSL 中引用变量时，经常会用到：
- `startInputField`（启动输入顶层字段）
- `{{http-1.body.xxx}}`（节点输出挂在 `variables["http-1"]` 下）
- `{{someGlobalKey}}`（若写回把值写到了顶层）

## 5. 变量引用/解析规则

### 5.1 `{{ ... }}` 模板替换（字符串内多处替换）

HTTP 节点 URL、headers、query、body 等字段支持字符串模板替换：

```txt
https://example.com/api?city={{city}}
Authorization: Bearer {{token}}
```

规则见 `renderTemplate()`：`web/lib/workflow-runtime/executors.ts`
- 支持形如 `{{ a.b.c }}` 的路径
- 解析不到则替换为空字符串
- 若值为对象，会 JSON stringify

### 5.2 `resolveValue()`（End 输出来源 / If-Else 条件左右值等）

用于把 “source”/条件值解析为真实值：

优先级：
1) 若值完全是 `{{path}}`：读取 `variables[path]`
2) 若字符串包含 `.` 且能按路径取到值：读取 `variables[path]`
3) 否则按标量解析：`true/false/数字/JSON`，失败则原字符串

实现见 `resolveValue()`：`web/lib/workflow-runtime/executors.ts`

## 6. 节点类型与 config 规则

### 6.1 Start（开始）

`data.type = "start"`

用途：生成开始表单；运行时不会额外产生新字段（Start 节点输出通常等于当前 variables 快照）。

关键 config：
- `config.variables: [{ name, label, type, required, defaultValue?, options? ... }]`

类型定义见：`web/components/workflow/dify/core/types.ts`

### 6.2 Input（人工输入/暂停点）

`data.type = "input"`

行为：如果未提供该节点输入，执行会进入 `waiting_input` 状态并返回 schema；用户提交后 `resume` 继续。

关键 config：
- `config.fields: [{ name, label, type, required, options, defaultValue }]`

实现：`InputNodeExecutor`（`web/lib/workflow-runtime/executors.ts`）

### 6.3 If-Else（条件分支）

`data.type = "if-else"`

关键 config：
- `config.conditions: [{ name, left, operator, right }]`
- `config.elseBranchName`

连线约定（分支路由依赖 Edge.sourceHandle）：
- 第 N 个条件命中：走 `sourceHandle = "if-branch-N"` 的边
- 否则：走 `sourceHandle = "if-else"` 的边（else fallback）

常量与函数：`web/lib/workflow-ifelse.ts`

### 6.4 HttpRequest（HTTP 请求）

`data.type = "http-request"`

关键 config（常用）：
- `method, url, query[], headers[], bodyType, body, timeout`
- `writebackMappings: [{ sourcePath, targetPath }]`

writeback 规则：
- `sourcePath` 取自响应体（优先解析 JSON；取不到时为 rawText）
- `targetPath` 写入全局变量路径（支持 `a.b.c` / `$` / `$.a.b[0]` 等简化）

实现：`HttpNodeExecutor`（`web/lib/workflow-runtime/executors.ts`）

### 6.5 Code（代码节点）

`data.type = "code"`

关键 config：
- `code: string`：JS 代码字符串（运行时用 `new Function` 执行）
- `writebackMappings: [{ sourcePath, targetPath }]`

代码约定：
- 需要导出 `main(input)` 函数，`input` 为当前全局变量表 `variables`
- `main` 返回对象即为该节点输出（会写入 `variables[nodeId]`）

实现：`CodeNodeExecutor`（`web/lib/workflow-runtime/executors.ts`）

注意：这是“可信环境执行代码”的实现方式，不适合不可信输入。

### 6.6 End（结束）

`data.type = "end"`

关键 config：
- `outputs: [{ name, source }]`：结束节点输出映射（推荐只配置你想要的最终字段，例如 `decision`）
- `templateId?: number`：可选，用于运行结束后把结束节点输出作为 context 进行模板渲染（渲染发生在前端展示层）

运行时输出规则（引擎）：
- 若 `outputs` 有至少一个有效 `name`：End 节点输出仅包含映射后的字段
- 若 `outputs` 为空或都没填 `name`：回退为输出全量 variables（兼容旧行为）

实现：`EndNodeExecutor`（`web/lib/workflow-runtime/executors.ts`）

### 6.7 joinAll / joinMode（多入边等待）

当一个节点有多个入边时，可通过节点 `config` 控制是否“等待所有上游到达再执行”：
- `config.joinAll = true` 或 `config.joinMode = "all" | "wait_all"`：等待所有入边到达后才入队执行

实现：`shouldWaitAllIncoming()`（`web/lib/workflow-runtime/xstate-runtime.ts`）

## 7. 最小示例：只输出 decision

```json
{
  "nodes": [
    {
      "id": "start-1",
      "type": "custom",
      "position": { "x": 0, "y": 0 },
      "data": {
        "title": "开始",
        "type": "start",
        "config": {
          "variables": [
            { "name": "city_budget_revenue", "label": "地市一般预算收入(亿元)", "type": "number", "required": true, "defaultValue": 80 }
          ]
        }
      }
    },
    {
      "id": "end-1",
      "type": "custom",
      "position": { "x": 360, "y": 0 },
      "data": {
        "title": "结束",
        "type": "end",
        "config": {
          "outputs": [
            { "name": "decision", "source": "{{summary.decision}}" }
          ]
        }
      }
    }
  ],
  "edges": [
    { "id": "e-1", "source": "start-1", "target": "end-1", "type": "custom" }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

说明：
- `summary` 必须来自你上游某个节点输出/写回（例如 code/http 节点产生了 `summary` 并写入全局或某节点输出）
- End 节点的 `source` 解析遵循 `resolveValue()` 规则

## 8. 常见坑排查清单

1) End 节点输出“比配置多很多字段”：检查 End 是否配置了 `outputs`，以及 `outputs[].name` 是否为空；空会回退输出全量变量。
2) `{{a.b}}` 取不到值：确认 `a` 是“顶层变量”还是“节点输出”（通常是 `{{nodeId.xxx}}`）。
3) If-Else 分支不生效：确认边的 `sourceHandle` 是否为 `if-branch-0/1/...` 或 `if-else`。
4) 多入边节点过早执行：给该节点 config 设置 `joinAll=true` 或 `joinMode="wait_all"`。

