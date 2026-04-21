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

## 报告模板编辑器（TipTap + AI 工具栏）

报告模板编辑页已从 ONLYOFFICE 迁移为 TipTap：

- 模板主内容仍持久化到 `contentMarkdown`
- 保留 Word 导入（`.docx`）与 Word 导出
- 提供 AI 工具栏（改写/扩写/总结/润色/续写），后端复用现有 AI 配置

若要使用 AI 功能，请先在用户配置中填写：

- `AIBaseURL`
- `AIApiKey`

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
make macdev   # macOS
make windev   # Windows
```

开发模式特性：

- 前端容器运行 `Vite dev server`，修改 `web/` 代码自动刷新
- 后端容器运行 `Air`，修改 `server/` 代码自动重编译重启
- Nginx 开发网关统一入口：`http://localhost:325`
- 直连调试端口：前端 `http://localhost:5173`，后端 `http://localhost:8080`
- 前端 `npm` 默认使用国内源：`https://registry.npmmirror.com`
- 后端 `Go` 默认使用国内代理：`https://goproxy.cn,direct`

### 跨平台启动命令

- `make macdev` 使用 `docker-compose.dev.mac.yml`，固定挂载：
  - `/Users/logan/Documents/code/pgsql` -> PostgreSQL 数据目录
  - `/Users/logan/Documents/code/pgfile` -> 后端文件上传目录
- `make windev` 使用 `docker-compose.dev.win.yml`，固定挂载：
  - `E:/code/xafgs-temp/pgsql` -> PostgreSQL 数据目录
  - `E:/code/xafgs-temp/pgfile` -> 后端文件上传目录

不再依赖 `HOST_DATA_ROOT` 环境变量。

## Makefile 快捷命令

```bash
make dev
make down
```

常用命令：

- `make dev`：开发模式启动（缓存重建 + 热更新）
- `make dev-fresh`：开发模式启动（无缓存重建 + 热更新）
- `make macdev`：macOS 开发模式启动（缓存重建 + 热更新）
- `make windev`：Windows 开发模式启动（缓存重建 + 热更新）
- `make dev-rebuild-backend`：缓存重建开发后端镜像
- `make dev-rebuild-backend-fresh`：无缓存重建开发后端镜像
- `make ocr-wheels-sync`：同步 OCR Python 依赖到本地 `ocr-service/wheels/`（增量缓存）
- `make ocr-wheels-verify`：校验 `wheels` 是否可离线覆盖依赖闭包
- `make ocr-model-cache-init`：初始化本地 OCR 模型缓存目录 `ocr-service/model_cache`
- `make ocr-model-cache-warm`：预热 OCR 模型到本地 `model_cache`（避免首个请求触发下载）
- `make ocr-build`：自动同步+校验 `wheels`，再离线构建 OCR 镜像（推荐）
- `make ocr-build-offline`：仅使用本地 `wheels` 构建 OCR 镜像（缺失依赖直接失败）
- `make ocr-build-online-fallback`：自动同步 `wheels` 后构建 OCR 镜像（允许缺失依赖回源下载）
- `make prod`：生产模式启动（后台）
- `make down`：停止开发+生产所有容器
- `make logs`：查看开发模式日志

## OCR 依赖缓存（wheels）

为避免每次构建 OCR 镜像都全量下载大包（如 `paddlepaddle`、`paddleocr`），项目支持本地 `wheels` 增量缓存：

```bash
make ocr-wheels-sync
make ocr-wheels-verify
make ocr-build
make ocr-model-cache-warm
```

说明：

- `make ocr-wheels-sync` 会将依赖下载到 `ocr-service/wheels/`，已存在文件会复用；
- 若 `paddlepaddle` 在默认索引不可用，可设置 `PADDLE_WHEEL_INDEX_URL`（默认 `https://www.paddlepaddle.org.cn/packages/stable/cpu/`）补充下载源；
- `paddlepaddle` 的 wheel 补拉采用 `--no-deps`，仅确保关键 wheel 文件落地，避免主机跨平台依赖解析干扰缓存同步；
- 已将 `protobuf==4.25.8` 显式纳入 OCR 依赖与离线关键检查，避免 `paddlepaddle` 在离线安装阶段因传递依赖缺失失败；
- `make ocr-wheels-verify` 默认按 `manylinux_2_17_x86_64 + py311` 离线校验依赖闭包；如需扩展平台可通过 `WHEEL_PLATFORMS_VERIFY` 覆盖；
- `make ocr-model-cache-warm` 会将 PaddleX 模型下载到本地 `ocr-service/model_cache/`；
- `make ocr-build` 会先自动同步本地 wheels，再做离线校验与构建，保证可复现；如需临时回源，使用 `make ocr-build-online-fallback`。
- `docker-compose` 中 `OCR_WHEELS_ONLY` 默认已设为 `1`（本地 wheel 优先且不回源）；仅 `make ocr-build-online-fallback` 会显式传入 `OCR_WHEELS_ONLY=0` 允许回源。
- `ocr-service` 已切换为 GLM OCR 适配服务，默认走项目内 `vllm`（`GLM_BASE_URL` 默认 `http://vllm:8000`），入口保持 `POST /layout-parsing`。
- CPU 稳定性参数默认启用：`FLAGS_use_mkldnn=0`、`FLAGS_enable_pir_api=0`、`FLAGS_enable_pir_in_executor=0`、`OMP_NUM_THREADS=1`、`MKL_NUM_THREADS=1`、`OPENBLAS_NUM_THREADS=1`。

## OCR 模型调用（GLM）

为避免模型每次重新下载，已启用两层缓存：

- **构建期缓存**：`Dockerfile` 使用 BuildKit cache mount 挂载 `/root/.paddlex`；
- **运行期缓存**：`docker-compose` 挂载 `./ocr-service/model_cache:/root/.paddlex`。

首次构建/运行会下载模型，后续重建会直接复用本地缓存目录。
当前 `docker-compose` 默认设置 `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=False`，会执行模型源连通性探测。

### 项目内 vLLM（默认）

- `docker-compose.dev.yml` 内置 `vllm` 服务，`ocr-service` 仅调用项目内地址，不再探测 `host.docker.internal` 等外部候选；
- 默认模型目录：`./ocr-service/model_cache/glm`（无模型则由 vLLM 首次拉取，有模型则复用缓存）；
- 可通过环境变量覆盖：
  - `GLM_BASE_URL`（默认 `http://vllm:8000`）
  - `GLM_MODEL`
  - `GLM_MODEL_PATH`（默认 `/models/glm-ocr`）
  - `VLLM_IMAGE`

## OCR 服务调用

- 官方推理接口：`POST /layout-parsing`
- 网关入口：`/ocr/*`（例如 `POST /ocr/layout-parsing`）
- 说明：当前 `ocr-service` 已统一切换为 GLM OCR 适配服务，无旧 OCR Task 接口

## GLM OCR 在线演示（本地）

- 演示入口：`http://localhost:325/app/ocr-demo-v3`
- 演示调用入口：`/api/ocr/table-repair-preview`
- 在线演示支持上传文档并展示：Markdown、版面块、OCR 结果、检测框、原始 JSON（可下载）

## 文本提取边界

- Word/PDF 原生文本提取在后端 `server/internal/service/document_parse_service.go` 中执行；
- OCR 服务仅负责图像/扫描内容识别与补全，不负责 DOCX/PDF 文本层抽取；

示例请求：

```json
{
  "file": "<base64>",
  "fileType": 0,
  "useTableRecognition": false,
  "visualize": false
}
```

### 本机预下载模型（不在容器内下载）

当你希望避免容器运行期首个 OCR 请求触发下载，可先在主机执行：

```bash
./ocr-service/scripts/download_models_local.sh
```

可选参数：

- `--clean`：下载前清理 `ocr-service/model_cache/official_models`
- `--no-verify`：下载后跳过关键模型目录校验

说明：

- 脚本会在本机创建隔离虚拟环境：`ocr-service/.tmp/model-download-venv`
- 模型下载目标目录：`ocr-service/model_cache`
- 默认模型源为 `aistudio`；可通过环境变量覆盖：`PADDLE_PDX_MODEL_SOURCE=huggingface ./ocr-service/scripts/download_models_local.sh`
- 执行完成后，容器会通过挂载目录直接复用模型缓存

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

## 报告案例文档

- 报告案例使用说明（含附件下载、PDF 解析验证）：`docs/report-cases-usage.md`
