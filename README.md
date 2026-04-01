# sxfgssever

基于 `React + Ant Design Pro + Go Fiber + Docker` 的高性能网页服务模板。

## 目录结构

- `web/`：前端（React + Ant Design Pro + Vite + TypeScript）
- `server/`：后端（Go + Fiber）
- `server/internal/handler/`：参数解析、响应返回
- `server/internal/service/`：业务逻辑层
- `server/internal/repository/`：数据访问层（DB/Redis 入口）
- `server/internal/model/`：领域模型与 DTO
- `deploy/nginx/nginx.conf`：网关配置（静态资源 + API 反向代理）
- `docker-compose.yml`：一键编排（frontend/backend/gateway/postgres/redis）

## 快速启动

```bash
docker compose up --build
```

启动后访问：

- 网页：`http://localhost:325`（公开首页，无需登录）
- 后端健康检查：`http://localhost:325/api/health`

页面路由：

- `/`：面向用户的公开主页（HTML + CSS 展示页）
- `/login`：登录页（Ant Design Pro 登录组件）
- `/app`：登录后控制台（Ant Design Pro 基础框架）
- `/app/workflow-editor`：工作流编辑（一级菜单）
- `/app/dify-workflow`：Dify 官方工作流画布（集成）
- `/app/workflow-runner`：工作流运行态（编辑器“运行”跳转）

## 工作流编辑模块（按功能拆分）

参考 `demo/little-tool-main/src/pages/WorkflowEditor` 的集成方式，当前项目采用同样的目录组织：

- `web/src/pages/WorkflowEditor/index.tsx`：页面入口
- `web/src/pages/WorkflowEditor/components/WorkflowCanvas.tsx`：编排主容器
- `web/src/pages/WorkflowEditor/components/NodeDrawer.tsx`：节点模板抽屉
- `web/src/pages/WorkflowEditor/components/DecisionConfigEditor.tsx`：决策节点配置
- `web/src/pages/WorkflowEditor/components/HttpRequestConfigEditor.tsx`：HTTP 节点配置
- `web/src/pages/WorkflowEditor/components/JsProcessorConfigEditor.tsx`：处理节点脚本配置
- `web/src/pages/WorkflowEditor/components/ScriptTestModal.tsx`：节点脚本/请求测试
- `web/src/pages/WorkflowEditor/components/FormConfig/FormConfigEditor.tsx`：输入表单配置
- `web/src/pages/WorkflowEditor/components/GlobalParamsPanel.tsx`：全局参数面板
- `web/src/pages/WorkflowEditor/components/nodes/BaseNode.tsx`：节点渲染
- `web/src/pages/WorkflowEditor/utils/types.ts`：类型定义
- `web/src/pages/WorkflowEditor/utils/validation.ts`：校验逻辑
- `web/src/pages/WorkflowEditor/utils/formKeys.ts`：表单键常量
- `web/src/pages/WorkflowEditor/utils/script.ts`：脚本占位符转换
- `web/src/pages/WorkflowEditor/demo.json`：默认流程模板
- `web/src/services/workflowStore.ts`：本地持久化（保存/读取/运行态 payload）

## 开发模式（代码挂载 + 热更新）

```bash
docker compose -f docker-compose.dev.yml up --build
```

开发模式特性：

- 前端容器运行 `Vite dev server`，修改 `web/` 代码自动刷新
- 后端容器运行 `Air`，修改 `server/` 代码自动重编译重启
- Nginx 开发网关统一入口：`http://localhost:325`
- 直连调试端口：前端 `http://localhost:5173`，后端 `http://localhost:8080`
- 前端 `npm` 默认使用国内源：`https://registry.npmmirror.com`
- 后端 `Go` 默认使用国内代理：`https://goproxy.cn,direct`

## Makefile 快捷命令

```bash
make dev
make down
```

常用命令：

- `make dev`：开发模式启动（缓存重建 + 热更新）
- `make dev-fresh`：开发模式启动（无缓存重建 + 热更新）
- `make dev-rebuild-backend`：缓存重建开发后端镜像
- `make dev-rebuild-backend-fresh`：无缓存重建开发后端镜像
- `make prod`：生产模式启动（后台）
- `make down`：停止开发+生产所有容器
- `make logs`：查看开发模式日志

## Dify 画布源码级集成（迁移版）

- 本项目的 `/app/dify-workflow` 已改为 **本地源码组件渲染**（非 iframe、非外部 Dify Web 跳转）。
- 迁移目录：
  - `web/src/pages/DifyWorkflow/migrated/`：Dify 风格节点、连线、类型与工具函数
  - `web/src/pages/DifyWorkflow/components/DifyWorkflowMigratedCanvas.tsx`：迁移版画布主容器
- 当前已具备：
  - 画布拖拽缩放、节点连线、添加节点、清空
  - 节点配置抽屉（标题/类型/描述）
  - 本地持久化（保存/恢复）
- 下一步可继续增强：
  - 对齐 Dify 更多节点类型与运行态
  - 对齐 Dify DSL/调试/变量面板

## 后端性能设计要点

- Fiber 高性能 HTTP 框架，低开销路由
- 中间件：请求 ID、recover、请求日志、压缩
- 超时控制：`ReadTimeout`、`WriteTimeout`、`IdleTimeout`
- Nginx 上游 keepalive，减少连接建立成本
- 预留 Redis/PostgreSQL 作为缓存和持久化层

## API 封装规范

### 统一响应格式

所有接口都返回以下结构：

```json
{
  "statusCode": 200,
  "code": "SUCCESS",
  "message": "获取成功",
  "data": {},
  "requestId": "xxx",
  "timestamp": "2026-03-26T10:00:00Z"
}
```

- `statusCode`：HTTP 状态码
- `code`：业务码（如 `SUCCESS`、`BAD_REQUEST`、`UNAUTHORIZED`）
- `message`：可读描述
- `data`：业务数据
- `requestId`：请求追踪 ID

### 身份校验

- 认证方式：`Authorization: Bearer <token>`
- 开发默认 Token：`dev-token`
- 未携带或无效 Token 时返回 `401` + `UNAUTHORIZED`
- 默认登录账号：`developer`
- 默认登录密码：`123456`
- 普通用户账号：`normal-user`
- 普通用户密码：`123456`
- 角色：`admin`（管理员）/`user`（普通用户）

### 参数校验

- 路径参数统一在 `handler` 层解析与校验
- 示例：`GET /api/users/:userId` 要求 `userId` 为正整数
- 参数不合法返回 `400` + `BAD_REQUEST`

### 请求日志

- 后端输出结构化请求日志（JSON）
- 字段包含：`requestId`、`method`、`path`、`statusCode`、`durationMs`、`ip`、`userAgent`、`userId(可选)`

## 接口示例

- `GET /api/health`：公开接口，健康检查
- `POST /api/auth/login`：公开接口，账号密码登录
- `GET /api/me`：受保护接口，获取当前认证用户
- `GET /api/users`：管理员接口，用户列表
- `GET /api/users/:userId`：管理员接口，按 ID 查询用户
- `POST /api/users`：管理员接口，创建用户
- `PUT /api/users/:userId`：管理员接口，更新用户
- `DELETE /api/users/:userId`：管理员接口，删除用户

## 工作流后端运行时（Go 原生）

工作流“执行”（executions）已完全迁移到 Go 后端实现，不依赖前端运行时。

- 运行时核心：`server/internal/workflowruntime/runtime.go`
- DSL 解析/最小校验：`server/internal/workflowruntime/dsl.go`
- 节点执行器（start/input/if-else/http-request/code/end）：`server/internal/workflowruntime/executors.go`
- 状态存储（当前内存版，可替换持久化）：`server/internal/workflowruntime/store.go`
- 运行时文档（节点事件/表单校验/日志）：`docs/workflow-runtime/README.md`

### 节点执行说明

- `code` 节点使用 `goja` 执行 JS（可信环境假设，勿用于不可信输入）

### 执行状态流转

- `running -> waiting_input -> running -> completed`
- 异常：`running/waiting_input -> failed`
- 取消：`running/waiting_input -> cancelled`

### API（Go 后端）

- `POST /api/workflow/executions`：创建并启动执行
- `GET /api/workflow/executions/:id`：查询执行详情
- `POST /api/workflow/executions/:id/resume`：提交输入并恢复执行
- `DELETE /api/workflow/executions/:id`：取消执行

## 前端 API 客户端封装

- 统一入口：`web/src/api.ts`
- 请求拦截器：自动注入 `Authorization` 与 `X-Request-ID`
- 响应拦截器：统一解析响应格式与错误结构
- Token 管理：`setAccessToken/getAccessToken/clearAccessToken`
