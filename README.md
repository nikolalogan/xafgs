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
make menu    # 推荐：菜单式启动/构建/缓存管理
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

- `make menu` 会按平台自动分发：Windows 走 PowerShell 菜单，macOS/Linux 走 Bash 菜单；
- `make macdev` 使用 `docker-compose.dev.mac.yml`，固定挂载：
  - `/Users/logan/Documents/code/pgsql` -> PostgreSQL 数据目录
  - `/Users/logan/Documents/code/pgfile` -> 后端文件上传目录
- `make windev` 使用 `docker-compose.dev.win.yml`，固定挂载：
  - `E:/code/xafgs-temp/pgsql` -> PostgreSQL 数据目录
  - `E:/code/xafgs-temp/pgfile` -> 后端文件上传目录
- `make down` / `make logs` / `make ps` / `make ocr-build*` / `make docling-build*` 会自动跟随当前平台选择对应的开发编排文件，不再固定写死 `docker-compose.dev.yml`

Windows 使用前请先确认：

- Docker Desktop 已启动且 Linux 引擎可用；
- 当前终端对 `desktop-linux` context 有访问权限；
- 若出现 `permission denied while trying to connect to the docker API`，请重启 Docker Desktop 或改用管理员 PowerShell 重新执行。

不再依赖 `HOST_DATA_ROOT` 环境变量。

## Makefile 快捷命令

```bash
make menu
make dev
make down
```

常用命令：

- `make menu`：菜单式启动/构建/缓存管理入口（推荐，打包入口含“打包所有/单独打包”二级菜单）
- `make dev`：开发模式启动（缓存重建 + 热更新）
- `make dev-fresh`：开发模式启动（无缓存重建 + 热更新）
- `make macdev`：macOS 开发模式启动（缓存重建 + 热更新）
- `make windev`：Windows 开发模式启动（缓存重建 + 热更新）
- `make dev-rebuild-backend`：缓存重建开发后端镜像
- `make dev-rebuild-backend-fresh`：无缓存重建开发后端镜像
- `make ocr-wheels-sync`：同步主 OCR Python 依赖到本地 `ocr-service/wheels/`（增量缓存）
- `make ocr-wheels-verify`：校验主 OCR `wheels` 是否可离线覆盖依赖闭包
- `make ocr-table-wheels-sync`：同步表格提取依赖到本地 `ocr-table-service/wheels/`（增量缓存）
- `make ocr-table-wheels-verify`：校验表格提取 `wheels` 是否可离线覆盖依赖闭包
- `make ocr-table-layout-model-cache-warm`：单独预热 `TATR detection` layout 模型缓存
- `make ocr-table-model-cache-warm`：单独预热 TATR `structure-recognition` 表格结构模型缓存
- `make ocr-table-cache-warm`：一次性预热表格提取全部模型缓存（detection + structure + timm）
- `make ocr-build`：自动同步+校验 `wheels`，再离线构建主 OCR 镜像（推荐）
- `make ocr-build-offline`：仅使用本地 `wheels` 构建主 OCR 镜像（缺失依赖直接失败）
- `make ocr-build-online-fallback`：自动同步 `wheels` 后构建主 OCR 镜像（允许缺失依赖回源下载）
- `make ocr-table-build`：自动同步+校验 `wheels`，再离线构建表格提取镜像（推荐）
- `make ocr-table-build-offline`：仅使用本地 `wheels` 构建表格提取镜像
- `make ocr-table-build-online-fallback`：自动同步 `wheels` 后构建表格提取镜像（允许缺失依赖回源）
- `make docling-wheels-sync`：同步 Docling Python 依赖到本地 `docling-service/wheels/`
- `make docling-model-cache-init`：初始化本地 Docling 模型缓存目录 `docling-service/model_cache`
- `make docling-model-cache-warm`：预热 Docling 模型到本地 `model_cache`
- `make docling-build`：自动同步+预热后离线构建 Docling 镜像（推荐）
- `make docling-build-offline`：仅使用本地 `wheels` 构建 Docling 镜像
- `make docling-build-online-fallback`：自动同步 `wheels` 后构建 Docling 镜像（允许缺失依赖回源）
- `make prod`：生产模式启动（后台）
- `make down`：停止开发+生产所有容器
- `make logs`：查看开发模式日志

## OCR 依赖缓存（wheels）

为避免每次构建 OCR 镜像或表格提取镜像都重复下载依赖，项目支持按服务拆分的本地 `wheels` 增量缓存：

```bash
make ocr-build
make ocr-table-wheels-sync
make ocr-table-wheels-verify
make ocr-table-build
make ocr-table-cache-warm
make ocr-table-layout-model-cache-warm
make ocr-table-model-cache-warm
```

说明：

- 首次启动 `ocr-table-service` 前，必须先执行 `make ocr-table-cache-warm`；若只想分步恢复，至少要依次执行 `make ocr-table-layout-model-cache-warm` 和 `make ocr-table-model-cache-warm`；
- `make ocr-table-cache-warm` 会一次性预热 `TATR detection` layout 与 TATR structure 默认模型；
- `make ocr-table-layout-model-cache-warm` 会将 `config.json / preprocessor_config.json / model.safetensors\(或 pytorch_model.bin\)` 预热到宿主机 `ocr-table-service/model_cache/table_extract/layout/`；
- `make ocr-table-model-cache-warm` 会将 TATR 所需 `config.json`、`preprocessor_config.json`、`processor_config.json`、`model.safetensors` 预热到宿主机 `ocr-table-service/model_cache/table_extract/structure/`；
- Windows 开发环境对应仓库路径为 `E:\code\xafgs\ocr-table-service\model_cache\table_extract\layout\config.json / preprocessor_config.json / model.safetensors\(或 pytorch_model.bin\)`；
- Windows 开发环境对应 structure 路径为 `E:\code\xafgs\ocr-table-service\model_cache\table_extract\structure\`；
- 预热后可先用 `Get-ChildItem ocr-table-service/model_cache/table_extract/layout -Filter config.json / preprocessor_config.json / model.safetensors\(或 pytorch_model.bin\)` 或 `find ocr-table-service/model_cache/table_extract/layout -name config.json / preprocessor_config.json / model.safetensors\(或 pytorch_model.bin\)` 验证 layout 文件存在；
- 再用 `Get-ChildItem ocr-table-service/model_cache/table_extract/structure -Filter config.json`、`Get-ChildItem ocr-table-service/model_cache/table_extract/structure -Filter preprocessor_config.json`、`Get-ChildItem ocr-table-service/model_cache/table_extract/structure -Filter processor_config.json`、`Get-ChildItem ocr-table-service/model_cache/table_extract/structure -Filter model.safetensors`，或 `find ocr-table-service/model_cache/table_extract/structure -maxdepth 1 \( -name config.json -o -name preprocessor_config.json -o -name processor_config.json -o -name model.safetensors \)` 验证 structure 四个关键文件存在，再启动或重启 `ocr-table-service`；
- `make ocr-wheels-sync` 会将主 OCR 依赖下载到 `ocr-service/wheels/`，已存在文件会复用；
- `ocr-service/wheels/` 仅用于主 `ocr-service` 构建缓存；`ocr-table-service/wheels/` 单独缓存表格提取重依赖；
- `make ocr-wheels-verify` / `make ocr-table-wheels-verify` 默认按 `manylinux_2_17_x86_64 + py311` 离线校验依赖闭包；如需扩展平台可通过 `WHEEL_PLATFORMS_VERIFY` 覆盖；
- `POST /ocr/table-extract` 当前默认表格结构识别模型为 `microsoft/table-transformer-structure-recognition`；
- 表格提取链路为：整页输入 -> `TATR detection` 检测 `table` -> 裁表 -> Hugging Face TATR `structure-recognition` 结构识别；
- `make ocr-table-layout-model-cache-warm` 会将 `microsoft/table-transformer-detection` 的 `config.json / preprocessor_config.json / model.safetensors\(或 pytorch_model.bin\)` 预热到 `ocr-table-service/model_cache/table_extract/layout/`；
- `make ocr-table-model-cache-warm` 会将 TATR 所需 `config.json`、`preprocessor_config.json`、`processor_config.json`、`model.safetensors` 预热到 `ocr-table-service/model_cache/table_extract/structure/`；
- `make ocr-table-cache-warm` 是推荐的首次启动命令，用于一次性补齐 detection + structure + timm 两套默认模型缓存；
- `ocr-table-service/model_cache/hf/` 用于表格提取链路的 Transformers 缓存；不复用 Docling 的 artifacts 目录；
- 默认策略改为“预热后运行”：`TATR detection` 与默认 TATR structure 模型都不再运行时在线拉取；
- `ocr-table-service` 现会在启动前预检默认 layout 与默认 structure 缓存；任一缺失都会直接启动失败，并给出 `make ocr-table-layout-model-cache-warm`、`make ocr-table-model-cache-warm`、`make ocr-table-cache-warm`、目标目录和缺失文件名；
- 若默认 structure 缓存缺少 `processor_config.json`，典型症状是网关 `/ocr/table-extract` 返回 `504`，同时 `ocr-table-service` 日志出现指向 Hugging Face `processor_config.json` 的 `Network is unreachable`；
- 如果 layout/TATR 模型文件缺失、相关依赖未就绪，或模型加载失败，`/ocr/table-extract` 会明确报错，不做旧模型自动回退；
- `make ocr-build` 会先自动同步主 OCR wheels，再做离线校验与构建；`make ocr-table-build` 只在需要表格提取时单独构建重型服务。
- `docker-compose` 中 `OCR_WHEELS_ONLY` 与 `OCR_TABLE_WHEELS_ONLY` 默认均为 `1`（本地 wheel 优先且不回源）；在线回源仅在对应 `*-online-fallback` 命令下显式开启。
- OCR 不默认采用运行时安装依赖，避免容器启动变慢且将失败暴露到更晚阶段。
- `ocr-service` 已切换为 GLM OCR 适配服务，默认走项目内 `vllm`（`GLM_BASE_URL` 默认 `http://vllm:8000`），入口保持 `POST /layout-parsing`。
- `ocr-service` 额外提供 `POST /markdown-ocr`，用于返回可直接嵌入 Docling 结果的 Markdown；同时暴露 KServe v2 兼容端点 `/v2/models/{model}/infer`，供 Docling 远程 OCR 试验接入。
- `POST /ocr/table-extract` 现在由独立的 `ocr-table-service` 提供；网关按路径透明转发，示例页面仍为 `http://localhost:325/app/table-extract-demo`。
- 新增 `docling-service`，提供 `POST /convert` 文档转换接口，并通过网关暴露为 `/docling/convert`。
- CPU 稳定性参数默认启用：`FLAGS_use_mkldnn=0`、`FLAGS_enable_pir_api=0`、`FLAGS_enable_pir_in_executor=0`、`OMP_NUM_THREADS=1`、`MKL_NUM_THREADS=1`、`OPENBLAS_NUM_THREADS=1`。

## OCR 模型调用（GLM）

GLM OCR 主服务本身不再内置重模型缓存；模型由项目内 `vllm` 容器负责加载和复用。表格提取链路继续使用独立缓存目录，不与 Docling 的 `tableformer` artifacts 共用目录。

- `./ocr-table-service/model_cache/table_extract/layout`：`TATR detection` layout 模型
- `./ocr-table-service/model_cache/table_extract/structure`：Hugging Face TATR `structure-recognition` 结构模型

### 项目内 vLLM（默认）

- `docker-compose.dev.yml` 内置 `vllm` 服务，`ocr-service` 仅调用项目内地址，不再探测 `host.docker.internal` 等外部候选；
- 默认模型目录：`./ocr-service/model_cache/glm`（无模型则由 vLLM 首次拉取，有模型则复用缓存）；
- 可通过环境变量覆盖：
  - `GLM_BASE_URL`（默认 `http://vllm:8000`）
  - `GLM_MODEL`
  - `GLM_MODEL_PATH`（默认 `/models/glm-ocr`）
  - `VLLM_IMAGE`
  - `GLM_READY_TIMEOUT_MS`（默认 `300000`，OCR 调用前等待 vLLM `/v1/models` 就绪的最长时间）

## OCR 服务调用

- 官方推理接口：`POST /layout-parsing`
- 网关入口：`/ocr/*`（例如 `POST /ocr/layout-parsing`）
- 说明：当前 `ocr-service` 已统一切换为 GLM OCR 适配服务，无旧 OCR Task 接口

## Docling 服务调用

- 服务目录：`docling-service/`
- 服务端口：`8091`
- 网关入口：`POST /docling/convert`
- 示例页面：`http://localhost:325/app/docling-demo`
- Docling 默认按离线文本层转换运行，并将文档内图片区域的 GLM Markdown OCR 结果原位写回正文；图片文件或扫描 PDF 在示例页切换为 GLM OCR。
- 可设置 `DOCLING_OCR_PROVIDER=glm_kserve` 试验 Docling 官方远程 OCR 流程，请求项目内 `ocr-service` 的 KServe v2 兼容 GLM OCR；默认值为 `none`，避免意外启用远程服务。
- 图片 OCR 失败会中断 `/docling/convert` 并返回错误，避免转换成功但图片仍残留 `<!-- image -->`；可通过 `DOCLING_IMAGE_OCR_TIMEOUT_SECONDS` 调整 Docling 等待 OCR 服务的时间。

## Docling 依赖缓存

为避免每次构建 `docling-service` 都重复下载依赖/模型，项目支持本地 `wheels` 与 `model_cache` 双缓存：

```bash
make docling-wheels-sync
make docling-model-cache-warm
make docling-build
```

说明：

- `make docling-wheels-sync` 会将 `docling-service/requirements.txt` 对应依赖下载到 `docling-service/wheels/`；
- `docling-service/wheels/` 仅作为宿主机构建缓存目录，Docker 构建时通过 BuildKit bind mount 挂载，不会进入最终镜像；
- `make docling-wheels-sync` 默认通过 1Panel Docker 镜像源 `docker.1panel.live/library/python:3.11-slim` 执行下载，可通过 `PYTHON_BASE_IMAGE` 覆盖；
- `make docling-model-cache-warm` 会将 Docling 所需 artifacts 预热到 `docling-service/model_cache/`；
- `docling-service/model_cache/` 是缓存根目录，`docling-service/model_cache/serve_artifacts/` 是运行时统一 artifacts 目录；
- Docling 预热默认通过 `HF_ENDPOINT=https://hf-mirror.com` 下载 Hugging Face 模型，也可在 `.env` 中覆盖为你自己的镜像或代理入口；
- 开发/构建阶段默认 Docker 基础镜像源为 1Panel 镜像源 `docker.1panel.live`，如有企业内网镜像源可通过 `BASE_REGISTRY` / `OCR_BASE_REGISTRY` 覆盖；
- Redis 默认使用 `docker.1panel.live/library/redis:8-alpine`，以兼容 Redis 8 写入的 RDB/AOF 数据格式；如需使用其他镜像源，可通过 `REDIS_IMAGE=可用镜像源/library/redis:8-alpine` 单独覆盖；
- Nginx 默认使用兼容的 `nginx:alpine`，以匹配当前免登录镜像源可用 tag；
- Docling 默认启用表格结构识别，财务报表等 PDF 会优先输出结构化表格而不是线性文本；
- Docling 的表格能力来自自身 `tableformer` artifacts；`/ocr/table-extract` 使用的是独立的 Hugging Face TATR `structure-recognition`，两者缓存目录和预热命令不同；
- `docling-service` 默认启用文档内图片区域的 GLM OCR 补充，可通过环境变量调节并发、超时和单文档图片数上限；
- `make docling-build` 默认使用本地 `wheels` 离线构建；
- Docling 不默认采用运行时安装依赖，避免启动更慢且失败更晚暴露；
- 若运行时报 `Cannot find an appropriate cached snapshot folder`，说明本地 `docling-service/model_cache/` 尚未预热完成。

可用以下命令确认缓存里已经存在关键文件：

```bash
find docling-service/model_cache -name model.safetensors
```

```powershell
Get-ChildItem docling-service/model_cache -Recurse -Filter model.safetensors
```

运行前也可确认统一目录已生成：

```bash
find docling-service/model_cache/serve_artifacts -type f \( -name model.safetensors -o -name tm_config.json \)
```

```powershell
Get-ChildItem docling-service/model_cache/serve_artifacts -Recurse -Include model.safetensors,tm_config.json
```

若默认镜像不可用，可先设置再预热：

```bash
HF_ENDPOINT=https://你的镜像或代理 make docling-model-cache-warm
```

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
