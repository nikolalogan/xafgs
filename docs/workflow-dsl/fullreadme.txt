---
  工作流 DSL 编写规则（完整版）

  本文档详细说明本项目中"工作流 DSL"的数据结构、变量解析规则、各节点配置字段与运行时行为，用于 AI 生成 DSL、手写 DSL、排查运行结果与节点输出不一致等问题。

  约定：本文所说的 "DSL" 均指 JSON（对象或 JSON 字符串）。

  ---
  目录

  1. #1-两种-dsl存储态-vs-运行态
  2. #2-根对象结构
  3. #3-nodeedge-的通用字段
  4. #4-运行时变量模型非常重要
  5. #5-变量引用解析规则
  6. #6-节点类型与-config-规则
    - #61-start开始节点
    - #62-input人工输入节点
    - #63-if-else条件分支节点
    - #64-httprequesthttp-请求节点
    - #65-code代码节点
    - #66-end结束节点
    - #67-llm大语言模型节点
    - #68-apirequestapi-请求节点
    - #69-iteration迭代节点
  7. #7-多入边节点等待策略joinall-joinmode
  8. #8-完整示例
  9. #9-常见坑排查清单

  ---
  1. 两种 DSL（存储态 vs 运行态）

  项目里存在两套非常接近的 DSL：

  1. 存储态 DSL（Dify 风格）：用于后台保存/编辑的 DSL，类型为 DifyWorkflowDSL
    - 文件：web/components/workflow/dify/core/types.ts
    - 包含额外的编辑器元数据（globalVariables、workflowParameters、workflowVariableScopes）
  2. 运行态 DSL（Runtime 风格）：用于运行引擎（/workflow-api/executions）启动执行的 DSL，类型为 WorkflowDSL
    - 文件：web/lib/workflow-types.ts、web/lib/workflow-dsl.ts
    - 精简版，只包含运行必需字段

  实际运行时，前端会将 Dify 风格节点/边"整理成运行态 DSL"并提交给运行 API。

  ---
  2. 根对象结构

  2.1 运行态 WorkflowDSL

  最小结构：

  {
    "nodes": [],
    "edges": [],
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  }

  解析规则：
  - nodes 必填且不能为空；节点会按 id/data/position 做最小校验
  - edges 可为空；边会按 id/source/target 做最小校验
  - viewport 可选，仅用于编辑器显示

  2.2 存储态 DifyWorkflowDSL

  在 nodes/edges/viewport 之外，还可以包含：

  {
    "globalVariables": [
      {
        "name": "apiKey",
        "valueType": "string",
        "defaultValue": "sk-xxx",
        "description": "API 密钥"
      }
    ],
    "workflowParameters": [
      {
        "name": "userId",
        "label": "用户ID",
        "valueType": "number",
        "required": true,
        "defaultValue": "0",
        "description": "当前用户ID"
      }
    ],
    "workflowVariableScopes": {
      "city": "string",
      "budget": "number"
    }
  }

  这些字段更多用于编辑器/校验（例如运行前校验），不一定直接影响运行结果。

  ---
  3. Node/Edge 的通用字段

  本项目沿用 ReactFlow 的 Node/Edge 形态，允许存在大量 UI 字段，但运行/解析只关心关键字段。

  3.1 Node（节点）

  关键字段（必须满足最小校验）：

  {
    "id": "start-1",           // 节点唯一 ID（强烈建议稳定且可读）
    "type": "custom",          // ReactFlow 节点类型（固定为 "custom"）
    "position": { "x": 0, "y": 0 },
    "data": {
      "title": "开始",        // 节点显示标题
      "desc": "流程开始",     // 可选描述
      "type": "start",        // 节点类型（见下文"节点类型与 config"）
      "config": {}            // 节点配置对象（结构因 type 而异）
    }
  }

  节点类型枚举（data.type）：
  - start - 开始节点
  - end - 结束节点
  - input - 人工输入节点
  - if-else - 条件分支节点
  - http-request - HTTP 请求节点
  - code - 代码节点
  - llm - 大语言模型节点
  - api-request - API 请求节点
  - iteration - 迭代节点

  3.2 Edge（连线）

  关键字段：

  {
    "id": "e-1",              // 边唯一 ID
    "type": "custom",         // ReactFlow 边类型（固定为 "custom"）
    "source": "start-1",      // 源节点 ID
    "target": "end-1",        // 目标节点 ID
    "sourceHandle": "if-branch-0"  // 可选：分支/端口选择（If-Else 分支依赖这个字段）
  }

  sourceHandle 说明：
  - If-Else 节点：if-branch-0、if-branch-1、if-else（else 分支）
  - 其他节点：通常不需要设置

  ---
  4. 运行时变量模型（非常重要）

  运行引擎维护一个"全局变量表" variables: Record<string, unknown>，其规则如下：

  4.1 变量初始化

  启动输入：执行开始时，variables = input（来自开始表单/调用参数）

  // 示例：启动时输入
  {
    "city": "杭州市",
    "budget": 80
  }
  // 运行时 variables = { city: "杭州市", budget: 80 }

  4.2 节点输出

  节点输出写入：每个节点执行成功后，会写入 variables[nodeId] = output

  // 示例：http-1 节点执行后
  variables["http-1"] = {
    "status": 200,
    "ok": true,
    "body": { "result": "成功" },
    "raw": "{\"result\":\"成功\"}"
  }

  4.3 写回机制（writebacks）

  写回到全局变量：部分节点（HTTP/Code）支持把输出按路径写回到全局变量（可写入任意层级路径）

  // 配置示例
  {
    "writebackMappings": [
      {
        "sourcePath": "body.result",  // 从节点输出的 body.result 读取
        "targetPath": "finalResult"   // 写入全局变量的 finalResult
      }
    ]
  }

  // 执行后：variables["finalResult"] = "成功"

  4.4 变量引用方式

  在 DSL 中引用变量时，常用以下方式：

  - {{city}} - 引用启动输入顶层字段
  - {{http-1.body.xxx}} - 引用节点输出（节点输出挂在 variables["http-1"] 下）
  - {{someGlobalKey}} - 引用写回的全局变量

  ---
  5. 变量引用/解析规则

  5.1 {{ ... }} 模板替换（字符串内多处替换）

  适用场景：HTTP 节点 URL、headers、query、body 等字段

  语法示例：

  https://example.com/api?city={{city}}&budget={{budget}}
  Authorization: Bearer {{token}}
  {"query": "{{city}}的预算是{{budget}}亿元"}

  解析规则（renderTemplate() 函数）：
  - 支持形如 {{ a.b.c }} 的路径（支持嵌套对象/数组访问）
  - 解析不到则替换为空字符串 ""
  - 若值为对象，会 JSON.stringify() 序列化

  路径语法：
  // 支持的路径格式
  {{nodeId.field}}           // 访问节点输出字段
  {{nodeId.data.items.0}}    // 访问数组元素
  {{nodeId.response.user.name}} // 多层嵌套

  5.2 resolveValue()（完整值解析）

  适用场景：End 输出来源、If-Else 条件左右值等

  解析优先级：

  1. 完整占位符：若值完全是 {{path}}，读取 variables[path]
  "{{http-1.body}}"  →  { result: "成功" }
  2. 路径解析：若字符串包含 . 且能按路径取到值，读取 variables[path]
  "http-1.body.result"  →  "成功"
  3. 标量解析：尝试解析为布尔值、数字、JSON，失败则返回原字符串
  "true"   →  true
  "123"    →  123
  "hello"  →  "hello"

  5.3 路径规范化

  路径格式（normalizePath() 函数）：

  // 支持的路径格式
  "$.data.items[0]"  →  "data.items.0"
  "data[1].name"     →  "data.1.name"
  "$"                →  "" (根对象)

  ---
  6. 节点类型与 config 规则

  6.1 Start（开始节点）

  节点类型：data.type = "start"

  用途：
  - 生成开始表单
  - 运行时输出等于当前 variables 快照

  Config 结构：

  {
    "config": {
      "variables": [
        {
          "name": "city",                    // 字段名（必填，唯一）
          "label": "城市名称",               // 显示标签（必填）
          "type": "text-input",              // 字段类型（必填）
          "required": true,                  // 是否必填
          "placeholder": "请输入城市名称",   // 占位符文本
          "defaultValue": "杭州市",          // 默认值
          "maxLength": 50,                   // 最大长度（text-input/paragraph）
          "min": 0,                          // 最小值（number）
          "max": 1000,                       // 最大值（number）
          "step": 0.1,                       // 步长（number）
          "options": [                       // 选项列表（select）
            { "label": "杭州市", "value": "hangzhou" },
            { "label": "宁波市", "value": "ningbo" }
          ],
          "multiSelect": false,              // 是否多选（select）
          "fileTypes": ["image/png", "image/jpeg"], // 文件类型（file/file-list）
          "maxFiles": 5,                     // 最大文件数（file-list）
          "jsonSchema": "{\"type\":\"object\"}", // JSON Schema（json_object）
          "visibleWhen": "{{role}} === 'admin'", // 可见条件表达式
          "validateWhen": "{{budget}} > 0"   // 校验条件表达式
        }
      ]
    }
  }

  字段类型枚举（type）：
  - text-input - 单行文本
  - paragraph - 多行文本
  - select - 下拉选择
  - number - 数字输入
  - checkbox - 复选框
  - file - 单文件上传
  - file-list - 多文件上传
  - json_object - JSON 对象编辑器

  完整示例：

  {
    "id": "start-1",
    "type": "custom",
    "position": { "x": 0, "y": 0 },
    "data": {
      "title": "开始",
      "type": "start",
      "config": {
        "variables": [
          {
            "name": "city_budget_revenue",
            "label": "地市一般预算收入(亿元)",
            "type": "number",
            "required": true,
            "defaultValue": 80,
            "min": 0,
            "max": 10000,
            "step": 0.1
          },
          {
            "name": "city_name",
            "label": "城市名称",
            "type": "text-input",
            "required": true,
            "placeholder": "请输入城市名称",
            "maxLength": 50
          },
          {
            "name": "risk_level",
            "label": "风险等级",
            "type": "select",
            "required": true,
            "options": [
              { "label": "低风险", "value": "low" },
              { "label": "中风险", "value": "medium" },
              { "label": "高风险", "value": "high" }
            ],
            "defaultValue": "low"
          }
        ]
      }
    }
  }

  ---
  6.2 Input（人工输入节点）

  节点类型：data.type = "input"

  用途：
  - 流程中暂停等待人工输入
  - 未提供输入时进入 waiting_input 状态
  - 用户提交后通过 resume API 继续执行

  Config 结构：

  {
    "config": {
      "fields": [
        {
          "name": "approval_decision",      // 字段名（必填，唯一）
          "label": "审批决策",              // 显示标签（必填）
          "type": "select",                 // 字段类型（必填）
          "required": true,                 // 是否必填
          "options": ["通过", "拒绝", "退回"], // 选项列表（select）
          "defaultValue": "通过",           // 默认值
          "visibleWhen": "{{role}} === 'admin'", // 可见条件表达式
          "validateWhen": "{{amount}} < 10000"   // 校验条件表达式
        }
      ]
    }
  }

  字段类型枚举（type）：
  - text - 单行文本
  - paragraph - 多行文本
  - number - 数字输入
  - select - 下拉选择

  运行时行为：

  1. 第一次执行：返回 waiting_input 状态 + schema
  {
    "status": "waiting_input",
    "waitingInput": {
      "nodeId": "input-1",
      "nodeTitle": "人工审批",
      "schema": {
        "fields": [
          {
            "name": "approval_decision",
            "label": "审批决策",
            "type": "select",
            "required": true,
            "options": ["通过", "拒绝", "退回"],
            "defaultValue": "通过"
          }
        ]
      }
    }
  }
  2. 用户提交：调用 POST /api/workflow/executions/:id/resume
  {
    "nodeInput": {
      "approval_decision": "通过"
    }
  }
  3. 继续执行：节点输出为归一化后的输入
  variables["input-1"] = {
    "approval_decision": "通过"
  }

  校验规则：
  - required 字段必须有值
  - number 类型必须为数字
  - select 类型值必须在 options 中

  完整示例：

  {
    "id": "input-1",
    "type": "custom",
    "position": { "x": 200, "y": 100 },
    "data": {
      "title": "人工审批",
      "desc": "等待审批人员确认",
      "type": "input",
      "config": {
        "fields": [
          {
            "name": "approval_decision",
            "label": "审批决策",
            "type": "select",
            "required": true,
            "options": ["通过", "拒绝", "退回"],
            "defaultValue": "通过"
          },
          {
            "name": "approval_comment",
            "label": "审批意见",
            "type": "paragraph",
            "required": false,
            "defaultValue": ""
          }
        ]
      }
    }
  }

  ---
  6.3 If-Else（条件分支节点）

  节点类型：data.type = "if-else"

  用途：
  - 根据条件选择执行分支
  - 支持多个条件顺序判断
  - 所有条件不满足时走 else 分支

  Config 结构：

  {
    "config": {
      "conditions": [
        {
          "name": "高风险分支",            // 分支名称（可选，默认"分支N"）
          "left": "{{budget}}",            // 左值（支持变量引用）
          "operator": "gt",                // 比较操作符（必填）
          "right": "100"                   // 右值（支持变量引用）
        }
      ],
      "elseBranchName": "默认分支"        // else 分支名称（可选，默认"else"）
    }
  }

  操作符枚举（operator）：

  | 操作符       | 说明           | 示例                            |
  |--------------|----------------|---------------------------------|
  | eq           | 等于           | {{value}} eq "success"          |
  | neq          | 不等于         | {{status}} neq "failed"         |
  | gt           | 大于           | {{budget}} gt 100               |
  | lt           | 小于           | {{score}} lt 60                 |
  | contains     | 包含（字符串） | {{text}} contains "error"       |
  | not_contains | 不包含         | {{text}} not_contains "success" |
  | empty        | 为空           | {{field}} empty                 |
  | not_empty    | 不为空         | {{field}} not_empty             |

  条件判断逻辑：
  1. 从第一个条件开始顺序判断
  2. 第一个满足条件的分支立即返回，后续条件不再判断
  3. 所有条件都不满足时，走 else 分支

  分支路由规则（Edge.sourceHandle）：

  // 第 0 个条件命中
  "sourceHandle": "if-branch-0"

  // 第 1 个条件命中
  "sourceHandle": "if-branch-1"

  // 所有条件都不满足（else 分支）
  "sourceHandle": "if-else"

  节点输出：

  // 命中分支时
  {
    "branch": "高风险分支",
    "branchHandle": "if-branch-0"
  }

  // else 分支
  {
    "branch": "默认分支",
    "branchHandle": "if-else"
  }

  完整示例：

  {
    "id": "if-else-1",
    "type": "custom",
    "position": { "x": 400, "y": 100 },
    "data": {
      "title": "风险判断",
      "type": "if-else",
      "config": {
        "conditions": [
          {
            "name": "高风险",
            "left": "{{budget}}",
            "operator": "gt",
            "right": "100"
          },
          {
            "name": "中风险",
            "left": "{{budget}}",
            "operator": "gt",
            "right": "50"
          }
        ],
        "elseBranchName": "低风险"
      }
    }
  }

  对应的边配置：

  {
    "edges": [
      {
        "id": "e-high-risk",
        "source": "if-else-1",
        "target": "high-risk-handler",
        "sourceHandle": "if-branch-0"
      },
      {
        "id": "e-medium-risk",
        "source": "if-else-1",
        "target": "medium-risk-handler",
        "sourceHandle": "if-branch-1"
      },
      {
        "id": "e-low-risk",
        "source": "if-else-1",
        "target": "low-risk-handler",
        "sourceHandle": "if-else"
      }
    ]
  }

  ---
  6.4 HttpRequest（HTTP 请求节点）

  节点类型：data.type = "http-request"

  用途：
  - 发起 HTTP/HTTPS 请求
  - 支持 GET/POST/PUT/PATCH/DELETE
  - 支持模板变量替换
  - 支持响应写回到全局变量

  Config 结构：

  {
    "config": {
      "method": "POST",                    // HTTP 方法（必填）
      "url": "https://api.example.com/query", // 请求 URL（必填，支持变量）
      "timeout": 30,                       // 超时时间（秒，默认 30）
      "authorization": {                   // 认证配置（可选）
        "type": "bearer",                  // 认证类型
        "apiKey": "{{apiToken}}",          // API Key（支持变量）
        "header": "Authorization"          // 认证 Header 名称
      },
      "query": [                           // Query 参数（可选）
        {
          "key": "city",
          "value": "{{city}}"
        }
      ],
      "headers": [                         // 请求头（可选）
        {
          "key": "Content-Type",
          "value": "application/json"
        }
      ],
      "bodyType": "json",                  // Body 类型（可选）
      "body": "{\"query\":\"{{city}}\"}",  // 请求体（支持变量）
      "outputSchema": "{\"type\":\"object\"}", // 输出 Schema（可选）
      "writebackMappings": [               // 写回映射（可选）
        {
          "sourcePath": "body.result",     // 响应路径
          "targetPath": "queryResult"      // 全局变量路径
        }
      ]
    }
  }

  字段详解：

  method（HTTP 方法）

  - 类型：string
  - 必填：是
  - 可选值：GET | POST | PUT | PATCH | DELETE

  url（请求 URL）

  - 类型：string
  - 必填：是
  - 支持变量：是
  - 示例：
  https://api.example.com/users/{{userId}}
  https://{{domain}}/api/query?city={{city}}

  timeout（超时时间）

  - 类型：number
  - 必填：否
  - 默认值：30
  - 单位：秒

  authorization（认证配置）

  {
    "type": "none" | "bearer" | "api-key", // 认证类型
    "apiKey": "sk-xxx",                     // API Key 或 Token
    "header": "Authorization"               // Header 名称（默认 Authorization）
  }

  认证类型说明：

  | 类型    | 说明         | Header 示例                           |
  |---------|--------------|---------------------------------------|
  | none    | 无认证       | -                                     |
  | bearer  | Bearer Token | Authorization: Bearer sk-xxx          |
  | api-key | API Key      | Authorization: sk-xxx 或自定义 Header |

  query（Query 参数）

  [
    { "key": "page", "value": "1" },
    { "key": "city", "value": "{{city}}" }
  ]

  最终拼接为：?page=1&city=杭州市

  headers（请求头）

  [
    { "key": "Content-Type", "value": "application/json" },
    { "key": "X-User-Id", "value": "{{userId}}" }
  ]

  bodyType（请求体类型）

  - 类型：string
  - 可选值：
    - none - 无请求体
    - json - JSON 格式（自动设置 Content-Type）
    - raw - 纯文本
    - x-www-form-urlencoded - 表单编码
    - form-data - 多部分表单

  body（请求体）

  - 类型：string
  - 支持变量：是
  - 示例：
  {
    "city": "{{city}}",
    "budget": {{budget}}
  }

  writebackMappings（写回映射）

  用途：将响应数据写回到全局变量

  [
    {
      "sourcePath": "body.result.score",  // 响应路径（从节点输出读取）
      "targetPath": "finalScore"          // 全局变量路径
    },
    {
      "sourcePath": "$",                  // $ 表示整个响应体
      "targetPath": "fullResponse"
    }
  ]

  sourcePath 支持的路径：
  - $ - 整个响应体
  - body - 响应体（JSON 解析后）
  - body.result.items.0 - 嵌套访问
  - status - HTTP 状态码
  - ok - 是否成功（200-299）
  - raw - 原始文本响应

  节点输出结构：

  {
    "status": 200,                      // HTTP 状态码
    "ok": true,                         // 是否成功（200-299）
    "body": { /* JSON 解析后的响应 */ }, // 响应体
    "raw": "原始响应文本"                // 原始文本
  }

  完整示例：

  {
    "id": "http-1",
    "type": "custom",
    "position": { "x": 600, "y": 100 },
    "data": {
      "title": "查询城市数据",
      "type": "http-request",
      "config": {
        "method": "POST",
        "url": "https://api.example.com/city/query",
        "timeout": 30,
        "authorization": {
          "type": "bearer",
          "apiKey": "{{apiToken}}",
          "header": "Authorization"
        },
        "query": [
          { "key": "format", "value": "json" }
        ],
        "headers": [
          { "key": "Content-Type", "value": "application/json" },
          { "key": "X-Request-Id", "value": "{{requestId}}" }
        ],
        "bodyType": "json",
        "body": "{\"city\":\"{{city}}\",\"year\":2024}",
        "writebackMappings": [
          {
            "sourcePath": "body.data.score",
            "targetPath": "cityScore"
          },
          {
            "sourcePath": "body.data.level",
            "targetPath": "riskLevel"
          }
        ]
      }
    }
  }

  变量解析失败处理：

  如果任何变量无法解析（{{xxx}} 找不到对应值），节点会返回失败：

  {
    "type": "failed",
    "error": "HTTP 节点参数未解析：apiToken, city"
  }

  ---
  6.5 Code（代码节点）

  节点类型：data.type = "code"

  用途：
  - 执行自定义 JavaScript 代码
  - 访问全局变量表
  - 计算/转换/聚合数据
  - 支持结果写回到全局变量

  Config 结构：

  {
    "config": {
      "language": "javascript",           // 语言（目前仅支持 javascript）
      "code": "function main(input) {...}", // 代码字符串（必填）
      "outputSchema": "{\"type\":\"object\"}", // 输出 Schema（可选）
      "outputs": ["result", "summary"],   // 输出字段列表（可选）
      "writebackMappings": [              // 写回映射（可选）
        {
          "sourcePath": "decision",
          "targetPath": "finalDecision"
        }
      ]
    }
  }

  代码约定：

  1. 必须导出 main 函数：
  function main(input) {
    // input 为当前全局变量表 variables
    // 返回对象即为节点输出
    return {
      result: "success",
      score: 95
    }
  }
  2. input 参数：
    - 类型：Record<string, unknown>
    - 内容：当前全局变量表 variables
    - 包含：启动输入、所有节点输出、写回的变量
  3. 返回值：
    - 类型：对象
    - 会写入 variables[nodeId]
    - 示例：
    return {
    summary: { decision: "通过", score: 95 },
    timestamp: Date.now()
  }

  执行环境：
  - 前端：浏览器环境（new Function 执行）
  - 后端：Go + goja（JavaScript 运行时）
  - 注意：不支持异步操作（async/await）

  writebackMappings（写回映射）：

  [
    {
      "sourcePath": "summary.decision",  // 从节点输出读取
      "targetPath": "finalDecision"      // 写入全局变量
    },
    {
      "sourcePath": "$",                 // $ 表示整个节点输出
      "targetPath": "codeResult"
    }
  ]

  完整示例 1：风险评分计算：

  {
    "id": "code-1",
    "type": "custom",
    "position": { "x": 800, "y": 100 },
    "data": {
      "title": "计算风险评分",
      "type": "code",
      "config": {
        "language": "javascript",
        "code": "function main(input) {\n  const budget = input.budget || 0;\n  const population = input.population || 0;\n  const riskScore = budget / population * 100;\n  \n  let level = 'low';\n  if (riskScore > 100) level = 'high';\n  else if (riskScore > 50) level = 'medium';\n  \n  return {\n    riskScore: Math.round(riskScore),\n    riskLevel: level,\n    timestamp: Date.now()\n  };\n}",
        "writebackMappings": [
          {
            "sourcePath": "riskScore",
            "targetPath": "finalRiskScore"
          },
          {
            "sourcePath": "riskLevel",
            "targetPath": "finalRiskLevel"
          }
        ]
      }
    }
  }

  完整示例 2：数据聚合：

  {
    "id": "code-2",
    "type": "custom",
    "position": { "x": 1000, "y": 100 },
    "data": {
      "title": "数据聚合",
      "type": "code",
      "config": {
        "language": "javascript",
        "code": "function main(input) {\n  // 获取所有 HTTP 节点的响应\n  const http1 = input['http-1'] || {};\n  const http2 = input['http-2'] || {};\n  \n  // 聚合数据\n  const summary = {\n    totalScore: (http1.body?.score || 0) + (http2.body?.score || 0),\n    decision: http1.body?.score > 80 ? '通过' : '拒绝',\n    sources: ['http-1', 'http-2']\n  };\n  \n  return { summary };\n}",
        "writebackMappings": [
          {
            "sourcePath": "summary",
            "targetPath": "finalSummary"
          }
        ]
      }
    }
  }

  错误处理：

  function main(input) {
    try {
      // 你的代码
      return { result: "success" };
    } catch (error) {
      // 错误会被捕获并返回失败
      return { error: error.message };
    }
  }

  注意事项：
  - ⚠️ 这是"可信环境执行代码"的实现方式
  - ⚠️ 不适合不可信输入（存在安全风险）
  - ⚠️ 不支持 import/require
  - ⚠️ 不支持异步操作（Promise/async/await）

  ---
  6.6 End（结束节点）

  节点类型：data.type = "end"

  用途：
  - 标记流程结束
  - 输出最终结果
  - 可选：关联模板渲染

  Config 结构：

  {
    "config": {
      "outputs": [                        // 输出映射（可选）
        {
          "name": "decision",             // 输出字段名
          "source": "{{summary.decision}}" // 数据来源（支持变量）
        }
      ],
      "templateId": 123                   // 模板 ID（可选）
    }
  }

  运行时输出规则：

  情况 1：配置了有效的 outputs

  {
    "outputs": [
      { "name": "decision", "source": "{{summary.decision}}" },
      { "name": "score", "source": "{{code-1.riskScore}}" }
    ]
  }

  // 节点输出仅包含映射后的字段
  {
    "decision": "通过",
    "score": 95
  }

  情况 2：outputs 为空或都没填 name

  {
    "outputs": []
  }

  // 回退为输出全量 variables（兼容旧行为）
  {
    "city": "杭州市",
    "budget": 80,
    "http-1": { ... },
    "code-1": { ... },
    "summary": { ... }
  }

  source 解析规则：

  遵循 resolveValue() 规则：

  // 完整占位符
  "source": "{{summary.decision}}"  →  "通过"

  // 路径引用
  "source": "code-1.riskScore"      →  95

  // 标量
  "source": "fixed-value"           →  "fixed-value"

  templateId（模板渲染）：

  - 类型：number
  - 用途：运行结束后，前端可使用 End 节点输出作为 context 进行模板渲染
  - 注意：渲染发生在前端展示层，不影响运行时输出

  完整示例 1：精简输出：

  {
    "id": "end-1",
    "type": "custom",
    "position": { "x": 1200, "y": 100 },
    "data": {
      "title": "结束",
      "type": "end",
      "config": {
        "outputs": [
          {
            "name": "decision",
            "source": "{{summary.decision}}"
          },
          {
            "name": "score",
            "source": "{{code-1.riskScore}}"
          },
          {
            "name": "level",
            "source": "{{code-1.riskLevel}}"
          }
        ]
      }
    }
  }

  完整示例 2：全量输出：

  {
    "id": "end-1",
    "type": "custom",
    "position": { "x": 1200, "y": 100 },
    "data": {
      "title": "结束",
      "type": "end",
      "config": {
        "outputs": []
      }
    }
  }

  完整示例 3：关联模板：

  {
    "id": "end-1",
    "type": "custom",
    "position": { "x": 1200, "y": 100 },
    "data": {
      "title": "结束",
      "type": "end",
      "config": {
        "outputs": [
          {
            "name": "decision",
            "source": "{{summary.decision}}"
          }
        ],
        "templateId": 123
      }
    }
  }

  ---
  6.7 LLM（大语言模型节点）

  节点类型：data.type = "llm"

  用途：
  - 调用大语言模型（如 GPT）
  - 生成文本、分析、总结等
  - 支持上下文传递

  Config 结构：

  {
    "config": {
      "model": "gpt-4",                   // 模型名称（必填）
      "temperature": 0.7,                 // 温度参数（0-2）
      "maxTokens": 2000,                  // 最大 Token 数
      "systemPrompt": "你是一个专业的分析师", // 系统提示词
      "userPrompt": "分析{{city}}的预算情况", // 用户提示词（支持变量）
      "contextEnabled": true              // 是否启用上下文
    }
  }

  字段详解：

  model（模型名称）

  - 类型：string
  - 必填：是
  - 示例：gpt-4, gpt-3.5-turbo, claude-3

  temperature（温度参数）

  - 类型：number
  - 范围：0-2
  - 默认值：0.7
  - 说明：控制输出随机性（0=确定性，2=高随机性）

  maxTokens（最大 Token 数）

  - 类型：number
  - 默认值：2000
  - 说明：限制输出长度

  systemPrompt（系统提示词）

  - 类型：string
  - 用途：定义 AI 角色和行为
  - 示例：
  你是一个专业的财务分析师，擅长分析城市预算数据。
  请用专业、客观的语言进行分析。

  userPrompt（用户提示词）

  - 类型：string
  - 支持变量：是
  - 示例：
  请分析{{city}}的预算情况：
  - 一般预算收入：{{budget}}亿元
  - 上年同期：{{lastYearBudget}}亿元

  请给出风险评估和建议。

  contextEnabled（启用上下文）

  - 类型：boolean
  - 默认值：false
  - 说明：是否传递之前的对话历史

  节点输出结构：

  {
    "text": "分析结果文本...",
    "usage": {
      "promptTokens": 150,
      "completionTokens": 500,
      "totalTokens": 650
    },
    "model": "gpt-4"
  }

  完整示例：

  {
    "id": "llm-1",
    "type": "custom",
    "position": { "x": 600, "y": 100 },
    "data": {
      "title": "预算分析",
      "type": "llm",
      "config": {
        "model": "gpt-4",
        "temperature": 0.7,
        "maxTokens": 2000,
        "systemPrompt": "你是一个专业的财务分析师，擅长分析城市预算数据。请用专业、客观的语言进行分析。",
        "userPrompt": "请分析{{city}}的预算情况：\n- 一般预算收入：{{budget}}亿元\n- 人口：{{population}}万人\n- 上年同期：{{lastYearBudget}}亿元\n\n请给出风险评估和建议。",
        "contextEnabled": false
      }
    }
  }

  注意事项：
  - ⚠️ 当前实现为占位符（PassthroughExecutor），实际调用需要集成 LLM API
  - ⚠️ 需要配置 API Key 和端点
  - ⚠️ 注意成本控制（maxTokens）

  ---
  6.8 ApiRequest（API 请求节点）

  节点类型：data.type = "api-request"

  用途：
  - 调用预定义的内部 API 路由
  - 支持参数验证和类型检查
  - 比 HttpRequest 更规范和安全

  Config 结构：

  {
    "config": {
      "route": {                          // API 路由信息（必填）
        "method": "POST",                 // HTTP 方法
        "path": "/api/internal/analyze"   // API 路径
      },
      "params": [                         // 参数定义（可选）
        {
          "name": "cityName",             // 参数名
          "in": "body",                   // 参数位置
          "type": "string",               // 参数类型
          "description": "城市名称",      // 参数描述
          "validation": {                 // 验证规则
            "required": true,             // 是否必填
            "enum": ["杭州市", "宁波市"], // 枚举值
            "min": 0,                     // 最小值
            "max": 100,                   // 最大值
            "pattern": "^[\\u4e00-\\u9fa5]+$" // 正则表达式
          }
        }
      ],
      "paramValues": [                    // 参数值（可选）
        {
          "name": "cityName",
          "in": "body",
          "value": "{{city}}"
        }
      ],
      "timeout": 30,                      // 超时时间（秒）
      "successStatusCode": 200,           // 成功状态码
      "writebackMappings": [              // 写回映射（可选）
        {
          "sourcePath": "result.score",
          "targetPath": "apiScore"
        }
      ]
    }
  }

  参数位置枚举（in）：
  - path - 路径参数（如 /api/users/:id）
  - query - Query 参数（如 ?page=1）
  - body - 请求体参数

  参数类型枚举（type）：
  - string - 字符串
  - number - 数字
  - boolean - 布尔值
  - object - 对象
  - array - 数组

  完整示例：

  {
    "id": "api-1",
    "type": "custom",
    "position": { "x": 600, "y": 100 },
    "data": {
      "title": "调用分析 API",
      "type": "api-request",
      "config": {
        "route": {
          "method": "POST",
          "path": "/api/internal/city/analyze"
        },
        "params": [
          {
            "name": "cityId",
            "in": "path",
            "type": "number",
            "description": "城市 ID",
            "validation": {
              "required": true,
              "min": 1
            }
          },
          {
            "name": "cityName",
            "in": "body",
            "type": "string",
            "description": "城市名称",
            "validation": {
              "required": true,
              "pattern": "^[\\u4e00-\\u9fa5]+$"
            }
          },
          {
            "name": "budget",
            "in": "body",
            "type": "number",
            "description": "预算金额",
            "validation": {
              "required": true,
              "min": 0
            }
          }
        ],
        "paramValues": [
          {
            "name": "cityId",
            "in": "path",
            "value": "{{cityId}}"
          },
          {
            "name": "cityName",
            "in": "body",
            "value": "{{city}}"
          },
          {
            "name": "budget",
            "in": "body",
            "value": "{{budget}}"
          }
        ],
        "timeout": 30,
        "successStatusCode": 200,
        "writebackMappings": [
          {
            "sourcePath": "data.score",
            "targetPath": "analysisScore"
          }
        ]
      }
    }
  }

  注意事项：
  - ⚠️ 当前实现为占位符（PassthroughExecutor）
  - ⚠️ 需要后端实现对应的 API 路由
  - ⚠️ 参数验证在后端执行

  ---
  6.9 Iteration（迭代节点）

  节点类型：data.type = "iteration"

  用途：
  - 遍历数组/列表
  - 对每个元素执行子流程
  - 支持并行/串行执行
  - 支持错误处理策略

  Config 结构：

  {
    "config": {
      "iteratorSource": "{{http-1.body.items}}", // 迭代源（必填，数组）
      "itemVar": "item",                  // 当前项变量名
      "indexVar": "index",                // 索引变量名
      "outputVar": "result",              // 输出变量名
      "outputSource": "{{code-1.result}}", // 输出来源
      "isParallel": false,                // 是否并行执行
      "parallelNums": 5,                  // 并行数量
      "errorHandleMode": "terminated",    // 错误处理模式
      "flattenOutput": false,             // 是否展平输出
      "children": {                       // 子流程（必填）
        "nodes": [...],                   // 子流程节点
        "edges": [...],                   // 子流程边
        "viewport": { "x": 0, "y": 0, "zoom": 1 }
      }
    }
  }

  字段详解：

  iteratorSource（迭代源）

  - 类型：string
  - 必填：是
  - 支持变量：是
  - 说明：必须解析为数组
  - 示例：
  "{{http-1.body.items}}"  →  [1, 2, 3, 4, 5]
  "{{cities}}"             →  ["杭州市", "宁波市"]

  itemVar（当前项变量名）

  - 类型：string
  - 默认值：item
  - 说明：在子流程中可通过 {{item}} 访问当前项

  indexVar（索引变量名）

  - 类型：string
  - 默认值：index
  - 说明：在子流程中可通过 {{index}} 访问当前索引（从 0 开始）

  outputVar（输出变量名）

  - 类型：string
  - 默认值：result
  - 说明：收集子流程输出的变量名

  outputSource（输出来源）

  - 类型：string
  - 说明：从子流程的哪个节点收集输出
  - 示例：
  "{{end-1.score}}"  // 收集子流程 end-1 节点的 score 字段
  "{{code-1}}"       // 收集子流程 code-1 节点的全部输出

  isParallel（并行执行）

  - 类型：boolean
  - 默认值：false
  - 说明：
    - false - 串行执行（按顺序逐个执行）
    - true - 并行执行（同时执行多个）

  parallelNums（并行数量）

  - 类型：number
  - 默认值：5
  - 说明：同时执行的子流程数量（仅在 isParallel=true 时生效）

  errorHandleMode（错误处理模式）

  - 类型：string
  - 可选值：
    - terminated - 遇到错误立即终止整个迭代
    - continue-on-error - 遇到错误继续执行，输出中包含错误项
    - remove-abnormal-output - 遇到错误继续执行，输出中移除错误项

  flattenOutput（展平输出）

  - 类型：boolean
  - 默认值：false
  - 说明：
    - false - 输出为数组：[result1, result2, result3]
    - true - 展平输出（如果每个结果也是数组）

  children（子流程）

  结构：

  {
    "nodes": [
      {
        "id": "start-1",
        "type": "custom",
        "position": { "x": 0, "y": 0 },
        "data": {
          "title": "开始",
          "type": "start",
          "config": {}
        }
      },
      {
        "id": "code-1",
        "type": "custom",
        "position": { "x": 200, "y": 0 },
        "data": {
          "title": "处理单项",
          "type": "code",
          "config": {
            "code": "function main(input) { return { score: input.item * 2 }; }"
          }
        }
      },
      {
        "id": "end-1",
        "type": "custom",
        "position": { "x": 400, "y": 0 },
        "data": {
          "title": "结束",
          "type": "end",
          "config": {
            "outputs": [
              { "name": "score", "source": "{{code-1.score}}" }
            ]
          }
        }
      }
    ],
    "edges": [
      { "id": "e-1", "source": "start-1", "target": "code-1" },
      { "id": "e-2", "source": "code-1", "target": "end-1" }
    ]
  }

  子流程变量访问：

  在子流程中可以访问：
  - {{item}} - 当前迭代项
  - {{index}} - 当前索引
  - {{父流程变量}} - 父流程的全局变量

  节点输出结构：

  {
    "items": [1, 2, 3, 4, 5],          // 原始迭代源
    "results": [2, 4, 6, 8, 10],       // 收集的输出
    "errors": [],                      // 错误列表
    "successCount": 5,                 // 成功数量
    "errorCount": 0                    // 错误数量
  }

  完整示例：批量处理城市数据：

  {
    "id": "iteration-1",
    "type": "custom",
    "position": { "x": 600, "y": 100 },
    "data": {
      "title": "批量分析城市",
      "type": "iteration",
      "config": {
        "iteratorSource": "{{http-1.body.cities}}",
        "itemVar": "city",
        "indexVar": "index",
        "outputVar": "analysisResult",
        "outputSource": "{{end-1.result}}",
        "isParallel": true,
        "parallelNums": 3,
        "errorHandleMode": "remove-abnormal-output",
        "flattenOutput": false,
        "children": {
          "nodes": [
            {
              "id": "start-1",
              "type": "custom",
              "position": { "x": 0, "y": 0 },
              "data": {
                "title": "开始",
                "type": "start",
                "config": {}
              }
            },
            {
              "id": "http-1",
              "type": "custom",
              "position": { "x": 200, "y": 0 },
              "data": {
                "title": "查询城市数据",
                "type": "http-request",
                "config": {
                  "method": "GET",
                  "url": "https://api.example.com/city/{{city.id}}",
                  "timeout": 10
                }
              }
            },
            {
              "id": "code-1",
              "type": "custom",
              "position": { "x": 400, "y": 0 },
              "data": {
                "title": "计算评分",
                "type": "code",
                "config": {
                  "code": "function main(input) {\n  const cityData = input['http-1'].body;\n  const score = cityData.budget / cityData.population * 100;\n  return { score: Math.round(score) };\n}"
                }
              }
            },
            {
              "id": "end-1",
              "type": "custom",
              "position": { "x": 600, "y": 0 },
              "data": {
                "title": "结束",
                "type": "end",
                "config": {
                  "outputs": [
                    {
                      "name": "result",
                      "source": "{{code-1}}"
                    }
                  ]
                }
              }
            }
          ],
          "edges": [
            { "id": "e-1", "source": "start-1", "target": "http-1" },
            { "id": "e-2", "source": "http-1", "target": "code-1" },
            { "id": "e-3", "source": "code-1", "target": "end-1" }
          ]
        }
      }
    }
  }

  注意事项：
  - ⚠️ 当前实现为占位符（PassthroughExecutor）
  - ⚠️ 并行执行需要注意资源消耗
  - ⚠️ 子流程不能包含 Input 节点（不支持嵌套等待）

  ---
  7. 多入边节点等待策略（joinAll / joinMode）

  场景说明：

  当一个节点有多个入边时，默认行为是"任意一个上游到达就执行"。但有些场景需要"等待所有上游到达再执行"。

  配置方式：

  在节点 config 中设置：

  {
    "config": {
      "joinAll": true,                   // 方式 1
      // 或
      "joinMode": "all",                 // 方式 2
      // 或
      "joinMode": "wait_all"             // 方式 3
    }
  }

  实现位置：shouldWaitAllIncoming() 函数（web/lib/workflow-runtime/xstate-runtime.ts）

  示例场景：数据汇总节点

  {
    "nodes": [
      {
        "id": "http-1",
        "type": "custom",
        "position": { "x": 0, "y": 0 },
        "data": { "title": "查询数据源A", "type": "http-request", "config": {} }
      },
      {
        "id": "http-2",
        "type": "custom",
        "position": { "x": 0, "y": 200 },
        "data": { "title": "查询数据源B", "type": "http-request", "config": {} }
      },
      {
        "id": "code-1",
        "type": "custom",
        "position": { "x": 400, "y": 100 },
        "data": {
          "title": "汇总数据",
          "type": "code",
          "config": {
            "joinAll": true,
            "code": "function main(input) {\n  const dataA = input['http-1'].body;\n  const dataB = input['http-2'].body;\n  return { summary: { a: dataA, b: dataB } };\n}"
          }
        }
      }
    ],
    "edges": [
      { "id": "e-1", "source": "http-1", "target": "code-1" },
      { "id": "e-2", "source": "http-2", "target": "code-1" }
    ]
  }

  注意事项：
  - 如果某个上游永远不到达（跳过/失败），节点会一直等待
  - 建议在分支合并点使用此策略

  ---
  8. 完整示例

  8.1 简单示例：城市预算评估

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
              {
                "name": "city",
                "label": "城市名称",
                "type": "text-input",
                "required": true,
                "defaultValue": "杭州市"
              },
              {
                "name": "budget",
                "label": "预算金额(亿元)",
                "type": "number",
                "required": true,
                "defaultValue": 80,
                "min": 0
              }
            ]
          }
        }
      },
      {
        "id": "http-1",
        "type": "custom",
        "position": { "x": 300, "y": 0 },
        "data": {
          "title": "查询城市数据",
          "type": "http-request",
          "config": {
            "method": "POST",
            "url": "https://api.example.com/city/query",
            "bodyType": "json",
            "body": "{\"city\":\"{{city}}\",\"budget\":{{budget}}}",
            "timeout": 30,
            "writebackMappings": [
              {
                "sourcePath": "body.data.score",
                "targetPath": "cityScore"
              }
            ]
          }
        }
      },
      {
        "id": "if-else-1",
        "type": "custom",
        "position": { "x": 600, "y": 0 },
        "data": {
          "title": "风险判断",
          "type": "if-else",
          "config": {
            "conditions": [
              {
                "name": "高风险",
                "left": "{{cityScore}}",
                "operator": "gt",
                "right": "80"
              }
            ],
            "elseBranchName": "低风险"
          }
        }
      },
      {
        "id": "code-1",
        "type": "custom",
        "position": { "x": 900, "y": -100 },
        "data": {
          "title": "高风险处理",
          "type": "code",
          "config": {
            "code": "function main(input) {\n  return {\n    summary: {\n      decision: '需要进一步审核',\n      score: input.cityScore,\n      level: 'high'\n    }\n  };\n}",
            "writebackMappings": [
              {
                "sourcePath": "summary",
                "targetPath": "summary"
              }
            ]
          }
        }
      },
      {
        "id": "code-2",
        "type": "custom",
        "position": { "x": 900, "y": 100 },
        "data": {
          "title": "低风险处理",
          "type": "code",
          "config": {
            "code": "function main(input) {\n  return {\n    summary: {\n      decision: '通过',\n      score: input.cityScore,\n      level: 'low'\n    }\n  };\n}",
            "writebackMappings": [
              {
                "sourcePath": "summary",
                "targetPath": "summary"
              }
            ]
          }
        }
      },
      {
        "id": "end-1",
        "type": "custom",
        "position": { "x": 1200, "y": 0 },
        "data": {
          "title": "结束",
          "type": "end",
          "config": {
            "outputs": [
              {
                "name": "decision",
                "source": "{{summary.decision}}"
              },
              {
                "name": "score",
                "source": "{{summary.score}}"
              },
              {
                "name": "level",
                "source": "{{summary.level}}"
              }
            ]
          }
        }
      }
    ],
    "edges": [
      {
        "id": "e-1",
        "type": "custom",
        "source": "start-1",
        "target": "http-1"
      },
      {
        "id": "e-2",
        "type": "custom",
        "source": "http-1",
        "target": "if-else-1"
      },
      {
        "id": "e-3",
        "type": "custom",
        "source": "if-else-1",
        "target": "code-1",
        "sourceHandle": "if-branch-0"
      },
      {
        "id": "e-4",
        "type": "custom",
        "source": "if-else-1",
        "target": "code-2",
        "sourceHandle": "if-else"
      },
      {
        "id": "e-5",
        "type": "custom",
        "source": "code-1",
        "target": "end-1"
      },
      {
        "id": "e-6",
        "type": "custom",
        "source": "code-2",
        "target": "end-1"
      }
    ],
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  }

  8.2 复杂示例：带人工审批的流程

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
              {
                "name": "amount",
                "label": "申请金额(万元)",
                "type": "number",
                "required": true,
                "min": 0
              }
            ]
          }
        }
      },
      {
        "id": "if-else-1",
        "type": "custom",
        "position": { "x": 300, "y": 0 },
        "data": {
          "title": "金额判断",
          "type": "if-else",
          "config": {
            "conditions": [
              {
                "name": "需要审批",
                "left": "{{amount}}",
                "operator": "gt",
                "right": "10"
              }
            ],
            "elseBranchName": "自动通过"
          }
        }
      },
      {
        "id": "input-1",
        "type": "custom",
        "position": { "x": 600, "y": -100 },
        "data": {
          "title": "人工审批",
          "type": "input",
          "config": {
            "fields": [
              {
                "name": "approval_decision",
                "label": "审批决策",
                "type": "select",
                "required": true,
                "options": ["通过", "拒绝"],
                "defaultValue": "通过"
              },
              {
                "name": "approval_comment",
                "label": "审批意见",
                "type": "paragraph",
                "required": false
              }
            ]
          }
        }
      },
      {
        "id": "code-1",
        "type": "custom",
        "position": { "x": 600, "y": 100 },
        "data": {
          "title": "自动通过",
          "type": "code",
          "config": {
            "code": "function main(input) {\n  return {\n    decision: '自动通过',\n    comment: '金额在限额内'\n  };\n}"
          }
        }
      },
      {
        "id": "end-1",
        "type": "custom",
        "position": { "x": 900, "y": 0 },
        "data": {
          "title": "结束",
          "type": "end",
          "config": {
            "joinAll": true,
            "outputs": [
              {
                "name": "decision",
                "source": "{{input-1.approval_decision}}"
              },
              {
                "name": "comment",
                "source": "{{input-1.approval_comment}}"
              }
            ]
          }
        }
      }
    ],
    "edges": [
      {
        "id": "e-1",
        "type": "custom",
        "source": "start-1",
        "target": "if-else-1"
      },
      {
        "id": "e-2",
        "type": "custom",
        "source": "if-else-1",
        "target": "input-1",
        "sourceHandle": "if-branch-0"
      },
      {
        "id": "e-3",
        "type": "custom",
        "source": "if-else-1",
        "target": "code-1",
        "sourceHandle": "if-else"
      },
      {
        "id": "e-4",
        "type": "custom",
        "source": "input-1",
        "target": "end-1"
      },
      {
        "id": "e-5",
        "type": "custom",
        "source": "code-1",
        "target": "end-1"
      }
    ],
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  }

  ---
  9. 常见坑排查清单

  9.1 End 节点输出异常

  问题：End 节点输出比配置多很多字段

  原因：
  - outputs 为空
  - outputs[].name 为空

  解决：
  {
    "config": {
      "outputs": [
        { "name": "decision", "source": "{{summary.decision}}" }
      ]
    }
  }

  9.2 变量引用失败

  问题：{{a.b}} 取不到值

  原因：
  - a 不是顶层变量
  - 节点输出应该用 {{nodeId.xxx}}

  解决：
  // 错误
  "{{response.data}}"

  // 正确（response 是节点 ID）
  "{{http-1.body.data}}"

  9.3 If-Else 分支不生效

  问题：条件满足但没走对应分支

  原因：Edge 的 sourceHandle 配置错误

  解决：
  {
    "edges": [
      {
        "source": "if-else-1",
        "target": "high-risk",
        "sourceHandle": "if-branch-0"  // 第 0 个条件
      },
      {
        "source": "if-else-1",
        "target": "low-risk",
        "sourceHandle": "if-else"       // else 分支
      }
    ]
  }

  9.4 多入边节点过早执行

  问题：汇总节点在某些上游还未完成时就执行了

  原因：未设置 joinAll

  解决：
  {
    "config": {
      "joinAll": true
    }
  }

  9.5 HTTP 请求变量未解析

  问题：节点失败，提示"HTTP 节点参数未解析"

  原因：
  - 变量不存在
  - 变量值为 null/undefined

  解决：
  - 检查变量是否已定义
  - 检查节点执行顺序
  - 使用 defaultValue 提供默认值

  9.6 Code 节点执行失败

  问题：节点失败，提示"代码执行失败"

  原因：
  - 未定义 main 函数
  - 代码语法错误
  - 访问了不存在的变量

  解决：
  // 正确
  function main(input) {
    // 安全访问
    const value = input['http-1']?.body?.data || {};
    return { result: value };
  }

  9.7 Iteration 节点问题

  问题：迭代源不是数组

  原因：iteratorSource 解析结果不是数组

  解决：
  {
    "config": {
      "iteratorSource": "{{http-1.body.items}}"
    }
  }

  确保 http-1.body.items 是数组。

  9.8 写回失败

  问题：writebackMappings 配置后变量仍然取不到

  原因：
  - sourcePath 路径错误
  - targetPath 被覆盖

  解决：
  {
    "writebackMappings": [
      {
        "sourcePath": "body.result",  // 确保路径正确
        "targetPath": "finalResult"   // 使用唯一的键名
      }
    ]
  }

  ---
  附录 A：节点类型速查表

  | 节点类型  | data.type    | 用途                   | 是否暂停 |
  |-----------|--------------|------------------------|----------|
  | 开始节点  | start        | 流程入口，定义输入表单 | 否       |
  | 结束节点  | end          | 流程出口，定义输出映射 | 否       |
  | 输入节点  | input        | 人工输入，流程暂停等待 | 是       |
  | 条件节点  | if-else      | 条件分支，多路径选择   | 否       |
  | HTTP 节点 | http-request | 发起 HTTP 请求         | 否       |
  | 代码节点  | code         | 执行自定义 JS 代码     | 否       |
  | LLM 节点  | llm          | 调用大语言模型         | 否       |
  | API 节点  | api-request  | 调用内部 API           | 否       |
  | 迭代节点  | iteration    | 遍历数组，批量处理     | 否       |

  ---
  附录 B：变量解析优先级

  1. 完整占位符 {{path}} → variables[path]
  2. 路径解析 a.b.c → variables["a"]["b"]["c"]
  3. 标量解析 "true" → true, "123" → 123
  4. 原字符串 其他 → 原值

  ---
  附录 C：实现文件清单

  | 功能             | 文件路径                                     |
  |------------------|----------------------------------------------|
  | 运行态 DSL 类型  | web/lib/workflow-types.ts                    |
  | 存储态 DSL 类型  | web/components/workflow/dify/core/types.ts   |
  | 节点执行器       | web/lib/workflow-runtime/executors.ts        |
  | 运行时引擎       | web/lib/workflow-runtime/xstate-runtime.ts   |
  | If-Else 工具函数 | web/lib/workflow-ifelse.ts                   |
  | DSL 校验         | web/lib/workflow-dsl.ts                      |
  | 后端运行时       | server/internal/workflowruntime/runtime.go   |
  | 后端执行器       | server/internal/workflowruntime/executors.go |
  | 后端 DSL 解析    | server/internal/workflowruntime/dsl.go       |

  ---
  附录 D：API 端点

  | 端点                                | 方法   | 说明               |
  |-------------------------------------|--------|--------------------|
  | /api/workflow/executions            | POST   | 创建并启动执行     |
  | /api/workflow/executions/:id        | GET    | 查询执行详情       |
  | /api/workflow/executions/:id/resume | POST   | 提交输入并恢复执行 |
  | /api/workflow/executions/:id        | DELETE | 取消执行           |

  ---
  文档版本：v2.0
  最后更新：2026-04-02
  作者：Claude Code

  ---