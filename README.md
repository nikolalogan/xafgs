# sxfgssever

基于 `React + Ant Design Pro + Go Fiber + Docker` 的高性能网页服务模板�?

## 目录结构

- `web/`：前端（React + Ant Design Pro + Vite + TypeScript�?
- `server/`：后端（Go + Fiber�?
- `server/internal/handler/`：参数解析、响应返�?
- `server/internal/service/`：业务逻辑�?
- `server/internal/repository/`：数据访问层（DB/Redis 入口�?
- `server/internal/model/`：领域模型与 DTO
- `deploy/nginx/nginx.conf`：网关配置（静态资�?+ API 反向代理�?
- `docker-compose.yml`：一键编排（frontend/backend/gateway/postgres/redis�?

## 报告模板编辑器（TipTap + AI 工具栏）

报告模板编辑页已�?ONLYOFFICE 迁移�?TipTap�?

- 模板主内容仍持久化到 `contentMarkdown`
- 保留 Word 导入（`.docx`）与 Word 导出
- 提供 AI 工具栏（改写/扩写/总结/润色/续写），后端复用现有 AI 配置

若要使用 AI 功能，请先在用户配置中填写：

- `AIBaseURL`
- `AIApiKey`

## 快速启�?

```bash
docker compose up --build
```

启动后访问：

- 网页：`http://localhost:325`（公开首页，无需登录�?
- 后端健康检查：`http://localhost:325/api/health`

页面路由�?

- `/`：面向用户的公开主页（HTML + CSS 展示页）
- `/login`：登录页（Ant Design Pro 登录组件�?
- `/app`：登录后控制台（Ant Design Pro 基础框架�?
- `/app/workflow-editor`：工作流编辑（一级菜单）
- `/app/dify-workflow`：Dify 官方工作流画布（集成�?
- `/app/workflow-runner`：工作流运行态（编辑器“运行”跳转）

## 工作流编辑模块（按功能拆分）

参�?`demo/little-tool-main/src/pages/WorkflowEditor` 的集成方式，当前项目采用同样的目录组织：

- `web/src/pages/WorkflowEditor/index.tsx`：页面入�?
- `web/src/pages/WorkflowEditor/components/WorkflowCanvas.tsx`：编排主容器
- `web/src/pages/WorkflowEditor/components/NodeDrawer.tsx`：节点模板抽�?
- `web/src/pages/WorkflowEditor/components/DecisionConfigEditor.tsx`：决策节点配�?
- `web/src/pages/WorkflowEditor/components/HttpRequestConfigEditor.tsx`：HTTP 节点配置
- `web/src/pages/WorkflowEditor/components/JsProcessorConfigEditor.tsx`：处理节点脚本配�?
- `web/src/pages/WorkflowEditor/components/ScriptTestModal.tsx`：节点脚�?请求测试
- `web/src/pages/WorkflowEditor/components/FormConfig/FormConfigEditor.tsx`：输入表单配�?
- `web/src/pages/WorkflowEditor/components/GlobalParamsPanel.tsx`：全局参数面板
- `web/src/pages/WorkflowEditor/components/nodes/BaseNode.tsx`：节点渲�?
- `web/src/pages/WorkflowEditor/utils/types.ts`：类型定�?
- `web/src/pages/WorkflowEditor/utils/validation.ts`：校验逻辑
- `web/src/pages/WorkflowEditor/utils/formKeys.ts`：表单键常量
- `web/src/pages/WorkflowEditor/utils/script.ts`：脚本占位符转换
- `web/src/pages/WorkflowEditor/demo.json`：默认流程模�?
- `web/src/services/workflowStore.ts`：本地持久化（保�?读取/运行�?payload�?

## 开发模式（代码挂载 + 热更新）

```bash
make menu    # 推荐：菜单式启动/构建/缓存管理
make macdev   # macOS
make windev   # Windows
```

开发模式特性：

- 前端容器运行 `Vite dev server`，修�?`web/` 代码自动刷新
- 后端容器运行 `Air`，修�?`server/` 代码自动重编译重�?
- Nginx 开发网关统一入口：`http://localhost:325`
- 直连调试端口：前�?`http://localhost:5173`，后�?`http://localhost:8080`
- 前端 `npm` 默认使用国内源：`https://registry.npmmirror.com`
- 后端 `Go` 默认使用国内代理：`https://goproxy.cn,direct`

### 跨平台启动命�?

- `make menu` 会按平台自动分发：Windows �?PowerShell 菜单，macOS/Linux �?Bash 菜单�?
- `make macdev` 使用 `docker-compose.dev.mac.yml`，固定挂载：
  - `/Users/logan/Documents/code/pgsql` -> PostgreSQL 数据目录
  - `/Users/logan/Documents/code/pgfile` -> 后端文件上传目录
- `make windev` 使用 `docker-compose.dev.win.yml`，固定挂载：
  - `E:/code/xafgs-temp/pgsql` -> PostgreSQL 数据目录
  - `E:/code/xafgs-temp/pgfile` -> 后端文件上传目录

Windows 使用前请先确认：

- Docker Desktop 已启动且 Linux 引擎可用�?
- 当前终端�?`desktop-linux` context 有访问权限；
- 若出�?`permission denied while trying to connect to the docker API`，请重启 Docker Desktop 或改用管理员 PowerShell 重新执行�?

不再依赖 `HOST_DATA_ROOT` 环境变量�?

## Makefile 快捷命令

```bash
make menu
make dev
make down
```

常用命令�?

- `make menu`：菜单式启动/构建/缓存管理入口（推荐，打包入口含“打包所�?单独打包”二级菜单）
- `make dev`：开发模式启动（缓存重建 + 热更新）
- `make dev-fresh`：开发模式启动（无缓存重�?+ 热更新）
- `make macdev`：macOS 开发模式启动（缓存重建 + 热更新）
- `make windev`：Windows 开发模式启动（缓存重建 + 热更新）
- `make dev-rebuild-backend`：缓存重建开发后端镜�?
- `make dev-rebuild-backend-fresh`：无缓存重建开发后端镜�?
- `make ocr-build`：自动同�?校验 `wheels`，再离线构建�?OCR 镜像（推荐）
- `make ocr-build-offline`：仅使用本地 `wheels` 构建�?OCR 镜像（缺失依赖直接失败）
- `make ocr-build-online-fallback`：自动同�?`wheels` 后构建主 OCR 镜像（允许缺失依赖回源下载）
- `make docling-model-cache-warm`：预�?Docling 模型到本�?`model_cache`
- `make prod`：生产模式启动（后台�?
- `make down`：停止开�?生产所有容�?
- `make logs`：查看开发模式日�?

## OCR 依赖缓存（wheels�?

为避免每次构�?OCR 镜像或表格提取镜像都重复下载依赖，项目支持按服务拆分的本�?`wheels` 增量缓存�?

```bash
make ocr-build
```

说明�?

- 表格提取链路为：整页输入 -> `TATR detection` 检�?`table` -> 裁表 -> Hugging Face TATR `structure-recognition` 结构识别�?
- 默认策略改为“预热后运行”：`TATR detection` 与默�?TATR structure 模型都不再运行时在线拉取�?
- `docker-compose` �?`OCR_WHEELS_ONLY` �?`OCR_TABLE_WHEELS_ONLY` 默认均为 `1`（本�?wheel 优先且不回源）；在线回源仅在对应 `*-online-fallback` 命令下显式开启�?
- OCR 不默认采用运行时安装依赖，避免容器启动变慢且将失败暴露到更晚阶段�?
- CPU 稳定性参数默认启用：`FLAGS_use_mkldnn=0`、`FLAGS_enable_pir_api=0`、`FLAGS_enable_pir_in_executor=0`、`OMP_NUM_THREADS=1`、`MKL_NUM_THREADS=1`、`OPENBLAS_NUM_THREADS=1`�?

## OCR 模型调用（GLM）

GLM OCR 链路已改为仅使用系统设置中的远程地址，不再依赖项目内本地 OCR 推理容器或默认基地址。

请在“系统设置”中配置并保存以下地址：
- `remoteOcrBaseUrl`
- `remoteOcrTableBaseUrl`
- `remoteDoclingBaseUrl`
emoteOcrTableBaseUrl
- 
emoteDoclingBaseUrl

任一地址为空时，后端相关接口会返回可读的配置缺失错误。

## OCR 服务调用

- 官方推理接口：`POST /layout-parsing`

## Docling 服务调用

- 服务端口：`8091`
- 示例页面：`http://localhost:325/app/docling-demo`
- Docling 默认按离线文本层转换运行，并将文档内图片区域�?GLM Markdown OCR 结果原位写回正文；图片文件或扫描 PDF 在示例页切换�?GLM OCR�?

## Docling 依赖缓存


```bash
make docling-wheels-sync
make docling-model-cache-warm
```

说明�?

- `make docling-wheels-sync` 默认通过 1Panel Docker 镜像�?`docker.1panel.live/library/python:3.11-slim` 执行下载，可通过 `PYTHON_BASE_IMAGE` 覆盖�?
- Docling 预热默认通过 `HF_ENDPOINT=https://huggingface.co` 下载 Hugging Face 模型，也可在 `.env` 中覆盖为你自己的镜像或代理入口；
- 开�?构建阶段默认 Docker 基础镜像源为 1Panel 镜像�?`docker.1panel.live`，如有企业内网镜像源可通过 `BASE_REGISTRY` / `OCR_BASE_REGISTRY` 覆盖�?
- Redis 默认使用 `docker.1panel.live/library/redis:8-alpine`，以兼容 Redis 8 写入�?RDB/AOF 数据格式；如需使用其他镜像源，可通过 `REDIS_IMAGE=可用镜像�?library/redis:8-alpine` 单独覆盖�?
- Nginx 默认使用兼容�?`nginx:alpine`，以匹配当前免登录镜像源可用 tag�?
- Docling 默认启用表格结构识别，财务报表等 PDF 会优先输出结构化表格而不是线性文本；
- Docling 不默认采用运行时安装依赖，避免启动更慢且失败更晚暴露�?

可用以下命令确认缓存里已经存在关键文件：

```bash
```

```powershell
```

运行前也可确认统一目录已生成：

```bash
```

```powershell
```

若默认镜像不可用，可先设置再预热�?

```bash
HF_ENDPOINT=https://你的镜像或代�?make docling-model-cache-warm
```

## GLM OCR 在线演示（本地）

- 演示入口：`http://localhost:325/app/ocr-demo-v3`
- 在线演示支持上传文档并展示：Markdown、版面块、OCR 结果、检测框、原�?JSON（可下载�?

## 文本提取边界

- Word/PDF 原生文本提取在后�?`server/internal/service/document_parse_service.go` 中执行；
- OCR 服务仅负责图�?扫描内容识别与补全，不负�?DOCX/PDF 文本层抽取；

示例请求�?

```json
{
  "file": "<base64>",
  "fileType": 0,
  "useTableRecognition": false,
  "visualize": false
}
```

### 本机预下载模型（不在容器内下载）

当你希望避免容器运行期首�?OCR 请求触发下载，可先在主机执行�?

```bash
```

可选参数：

- `--no-verify`：下载后跳过关键模型目录校验

说明�?

- 执行完成后，容器会通过挂载目录直接复用模型缓存

## Dify 画布源码级集成（迁移版）

- 本项目的 `/app/dify-workflow` 已改�?**本地源码组件渲染**（非 iframe、非外部 Dify Web 跳转）�?
- 迁移目录�?
  - `web/src/pages/DifyWorkflow/migrated/`：Dify 风格节点、连线、类型与工具函数
  - `web/src/pages/DifyWorkflow/components/DifyWorkflowMigratedCanvas.tsx`：迁移版画布主容�?
- 当前已具备：
  - 画布拖拽缩放、节点连线、添加节点、清�?
  - 节点配置抽屉（标�?类型/描述�?
  - 本地持久化（保存/恢复�?
- 下一步可继续增强�?
  - 对齐 Dify 更多节点类型与运行�?
  - 对齐 Dify DSL/调试/变量面板

## 后端性能设计要点

- Fiber 高性能 HTTP 框架，低开销路由
- 中间件：请求 ID、recover、请求日志、压�?
- 超时控制：`ReadTimeout`、`WriteTimeout`、`IdleTimeout`
- Nginx 上游 keepalive，减少连接建立成�?
- 预留 Redis/PostgreSQL 作为缓存和持久化�?

## API 封装规范

### 统一响应格式

所有接口都返回以下结构�?

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
- `code`：业务码（如 `SUCCESS`、`BAD_REQUEST`、`UNAUTHORIZED`�?
- `message`：可读描�?
- `data`：业务数�?
- `requestId`：请求追�?ID

### 身份校验

- 认证方式：`Authorization: Bearer <token>`
- 开发默�?Token：`dev-token`
- 未携带或无效 Token 时返�?`401` + `UNAUTHORIZED`
- 默认登录账号：`developer`
- 默认登录密码：`123456`
- 普通用户账号：`normal-user`
- 普通用户密码：`123456`
- 角色：`admin`（管理员�?`user`（普通用户）

### 参数校验

- 路径参数统一�?`handler` 层解析与校验
- 示例：`GET /api/users/:userId` 要求 `userId` 为正整数
- 参数不合法返�?`400` + `BAD_REQUEST`

### 请求日志

- 后端输出结构化请求日志（JSON�?
- 字段包含：`requestId`、`method`、`path`、`statusCode`、`durationMs`、`ip`、`userAgent`、`userId(可�?`

## 接口示例

- `GET /api/health`：公开接口，健康检�?
- `POST /api/auth/login`：公开接口，账号密码登�?
- `GET /api/me`：受保护接口，获取当前认证用�?
- `GET /api/users`：管理员接口，用户列�?
- `GET /api/users/:userId`：管理员接口，按 ID 查询用户
- `POST /api/users`：管理员接口，创建用�?
- `PUT /api/users/:userId`：管理员接口，更新用�?
- `DELETE /api/users/:userId`：管理员接口，删除用�?

## 工作流后端运行时（Go 原生�?

工作流“执行”（executions）已完全迁移�?Go 后端实现，不依赖前端运行时�?

- 运行时核心：`server/internal/workflowruntime/runtime.go`
- DSL 解析/最小校验：`server/internal/workflowruntime/dsl.go`
- 节点执行器（start/input/if-else/http-request/code/end）：`server/internal/workflowruntime/executors.go`
- 状态存储（当前内存版，可替换持久化）：`server/internal/workflowruntime/store.go`
- 运行时文档（节点事件/表单校验/日志）：`docs/workflow-runtime/README.md`

### 节点执行说明

- `code` 节点使用 `goja` 执行 JS（可信环境假设，勿用于不可信输入�?

### 执行状态流�?

- `running -> waiting_input -> running -> completed`
- 异常：`running/waiting_input -> failed`
- 取消：`running/waiting_input -> cancelled`

### API（Go 后端�?

- `POST /api/workflow/executions`：创建并启动执行
- `GET /api/workflow/executions/:id`：查询执行详�?
- `POST /api/workflow/executions/:id/resume`：提交输入并恢复执行
- `DELETE /api/workflow/executions/:id`：取消执�?

## 前端 API 客户端封�?

- 统一入口：`web/src/api.ts`
- 请求拦截器：自动注入 `Authorization` �?`X-Request-ID`
- 响应拦截器：统一解析响应格式与错误结�?
- Token 管理：`setAccessToken/getAccessToken/clearAccessToken`

## 报告案例文档

- 报告案例使用说明（含附件下载、PDF 解析验证）：`docs/report-cases-usage.md`

## 远程 OCR/Docling 配置
1. 启动系统后使用管理员进入“系统设置”。
2. 在系统设置填写并保存：
   - `remoteOcrBaseUrl`（ppv5）
   - `remoteOcrTableBaseUrl`（tatr）
   - `remoteDoclingBaseUrl`（docling）
3. 任一地址为空时，后端相关接口会返回配置缺失错误。

