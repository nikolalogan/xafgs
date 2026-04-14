# 报告案例使用说明

## 文件下载

报告案例页面的“已挂接文件”列表支持直接下载附件。

## 容器构建国内源

当前仓库已把开发/生产构建统一切到仓库内显式国内源，不再默认依赖 `docker.io`：

- Docker 基础镜像默认前缀：`docker.m.daocloud.io`
- Debian `apt` 默认源：`https://mirrors.aliyun.com/debian`
- Debian Security 默认源：`https://mirrors.aliyun.com/debian-security`
- Python `pip` 默认源：`https://mirrors.aliyun.com/pypi/simple`
- Node `npm` 默认源：`https://registry.npmmirror.com`
- Go module 默认源：`https://goproxy.cn,direct`

覆盖方式：

- `BASE_REGISTRY`
- `APT_MIRROR`
- `APT_SECURITY_MIRROR`
- `PIP_INDEX_URL`
- `PIP_TRUSTED_HOST`
- `PIP_DEFAULT_TIMEOUT`
- `PIP_RETRIES`
- `NPM_REGISTRY`
- `GOPROXY`
- `GOSUMDB`
- `APK_MIRROR`

例如：

```bash
BASE_REGISTRY=mirror.ccs.tencentyun.com \
APT_MIRROR=https://mirrors.aliyun.com/debian \
APT_SECURITY_MIRROR=https://mirrors.aliyun.com/debian-security \
PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple \
PIP_DEFAULT_TIMEOUT=600 \
PIP_RETRIES=10 \
APK_MIRROR=mirrors.aliyun.com \
docker compose -f docker-compose.dev.yml build backend ocr-service
```

说明：

- 当前 compose 已对 `node`、`nginx`、`postgres`、`redis`、`golang`、`python`、`debian` 相关镜像启用国内前缀
- 当前前端开发容器里的 `apk add` 也会先切到 `APK_MIRROR`
- 如果你本机 Docker daemon 已配置镜像加速器，仍可继续使用；仓库内显式国内源只是进一步降低环境依赖
- Apple Silicon 开发机上的 `ocr-service` 已固定为 `linux/amd64`，因为当前本地 OCR 依赖链按 x86 Linux 运行更稳，且生产环境本身就是 x86
- `ocr-service` 的 pip 安装已启用长超时、重试，并优先使用本地 wheel；当前不复用 pip 缓存，以避免坏缓存导致的二进制包损坏
- `ocr-service` 现在会优先从 `ocr-service/wheels/` 查找本地 wheel；只有缺失时才回退到 `PIP_INDEX_URL`
- `ocr-service` 已使用 `constraints.txt` 锁定重型依赖版本，避免 pip 在 `opencv`、`scipy`、`scikit-*` 等包上反复回溯
- `ocr-service` 镜像已补 `libgomp1`、`libstdc++6`，用于满足 `paddlepaddle` 的基础运行库依赖

### OCR 本地 wheel 优先机制

如果你已经手动下载了大体积 Python 包，放到以下目录即可：

- `ocr-service/wheels/`

例如可放入：

- `opencv_contrib_python-*.whl`
- `paddlepaddle-*.whl`
- `PyMuPDF-*.whl`

当前 `ocr-service` 构建策略：

1. 先从 `ocr-service/wheels/` 查找本地 wheel
2. 本地没有命中时，再从 `PIP_INDEX_URL` 下载

典型构建命令：

```bash
docker compose -f docker-compose.dev.yml build ocr-service
```

如果你要手动预热 V3 大包，建议至少放：

- `paddleocr==3.4.0`
- `paddlepaddle==3.2.0` 对应 `linux_x86_64`
- `opencv_contrib_python==4.10.0.84` 对应 `linux_x86_64`
- `opencv_python==4.10.0.84` 对应 `linux_x86_64`

推荐下载命令：

```bash
./ocr-service/scripts/download_wheels.sh
```

离线优先构建（只用本地 wheels，不访问线上 pip）：

```bash
OCR_WHEELS_ONLY=1 docker compose -f docker-compose.dev.yml build --no-cache ocr-service
```

离线构建前建议先检查关键 wheel：

```bash
find "ocr-service/wheels" -maxdepth 1 -type f -name "paddlepaddle-3.2.0*.whl"
find "ocr-service/wheels" -maxdepth 1 -type f -name "paddleocr-3.4.0*.whl"
find "ocr-service/wheels" -maxdepth 1 -type f -name "paddlex-3.4*.whl"
find "ocr-service/wheels" -maxdepth 1 -type f -name "opencv_contrib_python-4.10.0.84*.whl"
```

说明：

- 下载脚本会同时尝试 `manylinux2014_x86_64` 和 `manylinux_2_28_x86_64`
- 当前 `constraints.txt` 已锁定 `paddlex==3.4.3` 与 `opencv-contrib-python==4.10.0.84`，避免 resolver 在 3.4.x 内反复回溯

### 操作步骤

1. 进入 ` /app/report-cases `
2. 选择一个报告案例
3. 在“已挂接文件”表格中点击“下载”

## 文件管理页解析

文件管理页中的按钮语义区分如下：

- `解析引用`：仅解析 `fileId + versionNo` 到具体文件版本，不触发文档内容解析
- `解析`：直接触发单文件文档解析预览，不落报告案例库

适用位置：

- 文件管理列表
- 文件版本弹窗列表

### 鉴权说明

- 下载接口要求登录态
- 前端会自动从本地读取 `sxfg_access_token` / `access_token` / `token`
- 请求头格式固定为：

```http
Authorization: Bearer <token>
```

如果缺少令牌或令牌失效，会提示下载失败或返回 401。

### 下载接口

- 页面代理接口：`GET /api/files/{fileId}/download?versionNo={versionNo}`
- 后端接口：`GET /api/files/{fileId}/download?versionNo={versionNo}`

如果不传 `versionNo`，后端会按最新已上传版本处理。

## 文件解析实现分类（PDF / Word / XLSX / OCR）

本节从**实现链路**视角整理当前解析能力，和前面的构建/部署说明解耦。

| 类型 | 触发条件 | 解析策略（`parseStrategy`） | 来源类型（`sourceType`） | 主要输出 |
| --- | --- | --- | --- | --- |
| PDF | `fileType=pdf` | `pdf_pymupdf_text` / `pdf_mupdf_text` / `pdf_native_fallback` / `needs_ocr` | `text_layer` 或 `binary` | 页切片、候选表格、候选图表、OCR 待处理页 |
| Word (DOCX) | `fileType=docx` | `docx_ooxml_native` | `native_text` | 逻辑页切片、结构化表格、单元格 |
| Excel (XLSX) | `fileType=xlsx` | `xlsx_ooxml_native` | `native_text` | 工作表文本切片、结构化表格、单元格 |
| OCR | 命中 `needs_ocr` 或无文本层 | `needs_ocr`（前置判定）+ OCR 回装 | `binary`（前置判定） | OCR 页/块/表格/单元格并回装文档结构 |

### PDF 实现

- 解析链路：`PyMuPDF -> MuPDF(mutool) -> native parser`，按可用性和抽取结果回退。
- 文本层判定：有文本层则走正文/表格候选抽取；无文本层或近似扫描件则标记 `needs_ocr`。
- 关键策略：
  - 正常文本：`pdf_pymupdf_text` 或 `pdf_mupdf_text`
  - 回退解析：`pdf_native_fallback`
  - OCR 前置：`needs_ocr`
- 输出结构：
  - 正常路径：页级 `DocumentSlice` + `table_candidate` / `figure_candidate`
  - OCR 路径：生成“待 OCR 页 N”切片（`parseStatus=needs_ocr`）
- 典型来源回链：`第N页`、`第N页/块M`、`第N页/块M/单元格RxCy`。

### Word（DOCX）实现

- 解析链路：基于 OOXML 原生解析（`word/document.xml` 等），不走渲染识别。
- 关键策略：`parseStrategy=docx_ooxml_native`，`sourceType=native_text`。
- 输出结构：
  - 段落/标题转为文本切片
  - 表格转为 `DocumentTable` / `DocumentTableCell`
  - 支持 `gridSpan`、`vMerge` 的基础还原
- 典型来源回链：`第1逻辑页/表格T/单元格RxCy`。

### Excel（XLSX）实现

- 解析链路：基于 OOXML 原生解析（workbook/sheet/sharedStrings/styles）。
- 关键策略：`parseStrategy=xlsx_ooxml_native`，`sourceType=native_text`。
- 输出结构：
  - 工作表文本内容切片
  - 结构化表格与单元格
  - 合并单元格 `rowSpan/colSpan`、公式元数据、日期样式保守转换
- 规则补充：跳过隐藏行/列，优先保留可追溯来源字段。
- 典型来源回链：`工作表[SheetName]/单元格A1`。

### OCR 实现

- 架构：主后端负责判定与任务编排，`ocr-service` 负责真实 OCR 执行与 provider 路由。
- 当前本地实现：`local_pp_structure_v3`（PP-StructureV3 provider）。
- provider 输出统一映射为：
  - `pages[].text`
  - `pages[].blocks[]`
  - `pages[].tables[]`
  - `tables[].cells[]`
- 回装规则：OCR 结果由后端组装成 `DocumentSlice/Table/Cell`，并写入来源回链：
  - `第N页`
  - `第N页/块M`
  - `第N页/表格T/单元格RxCy`
- 降级行为：
  - 本地 provider 不可用时返回明确错误（依赖缺失/运行库缺失）
  - 远程 provider 未配置时返回配置错误，不伪造成功结果

## PDF 解析验证

建议用 4 类样本验证：

1. 纯文本 PDF
2. 含表格的文本层 PDF
3. 正文 + 表格混合 PDF
4. 扫描件 PDF

### 成功标准

- 纯文本 PDF：
  - 生成页级 `DocumentSlice`
  - 正文能落为 `section` / `paragraph`
- 表格 PDF：
  - 能看到 `table_candidate`
  - 能生成 `DocumentTable` / `DocumentTableFragment` / `DocumentTableCell`
- 扫描件 PDF：
  - 标记为 `needs_ocr`
  - 不生成伪正文和伪表格

### 乱码处理说明

当前系统默认优先使用 `PyMuPDF`：

1. `PyMuPDF` 提取页正文、块/行定位
2. `PyMuPDF page.find_tables()` 提取规则表格
3. 当 `PyMuPDF` 不可用或抽取失败时，回退到 `MuPDF/mutool`
4. 当 `MuPDF` 仍不可用或抽取失败时，再回退到内置 PDF 解析器

部署要求：

- 后端镜像已内置 `python3`、`PyMuPDF`、`mupdf-tools`
- 如本地非容器运行，需保证 `python3` 可执行，且已安装 `PyMuPDF`
- 若触发回退链，再要求 `mutool` 在 `PATH` 中可执行

### OCR 服务架构

当前 OCR 已按独立模块预留为：

- 主后端：负责文件读取、是否需要 OCR 的判定、OCR 任务状态管理
- `ocr-service`：负责真实 OCR 执行与 provider 路由
- 本地 OCR：预留 `PP-Structure`
- 远程 OCR：预留 `腾讯云 OCR`

主后端通过环境变量 `OCR_SERVICE_BASE_URL` 调用 OCR 服务。

当前任务流为：

1. 用户点击“解析”
2. 若文件命中 `needs_ocr`
3. 主后端创建 OCR 任务并提交到 `ocr-service`
4. 前端可通过 `/api/files/:fileId/ocr-status?versionNo=` 查询状态
5. OCR 完成后，再次调用解析接口即可拿到 OCR 结构化结果

OCR 统一目标输出：

- 页文本
- 块级文本
- 表格
- 单元格
- 坐标与来源回链

### 本地 PP-Structure 已实现的能力

`ocr-service` 当前已升级为本地 `PP-StructureV3` provider，处理链如下：

1. 图片文件：写入临时文件后送入 `PP-StructureV3`
2. PDF 文件：写入临时文件后交给 `PP-StructureV3` 直接分页解析
3. 结构化输出统一映射为：
   - `pages[].text`
   - `pages[].blocks[]`
   - `pages[].tables[]`
   - `tables[].cells[]`

V3 表格处理规则：

- 优先使用 `PP-StructureV3` 返回的 `pred_html` 重建行列结构
- 若 provider 返回 `cell_box_list` / `table_ocr_pred`，会补到单元格文本、置信度和坐标
- 若只拿到 HTML 结构，仍会保留行列和单元格文本，但单元格坐标可能为空

当前环境变量：

- `OCR_LOCAL_PPSTRUCTURE_ENABLED`
- `OCR_PPSTRUCTURE_DEVICE`：`cpu` / `gpu`
- `OCR_PPSTRUCTURE_LANG`
- `OCR_PPSTRUCTURE_MODEL_ROOT`
- `OCR_PPSTRUCTURE_USE_DOC_ORIENTATION_CLASSIFY`
- `OCR_PPSTRUCTURE_USE_DOC_UNWARPING`
- `OCR_PPSTRUCTURE_USE_TEXTLINE_ORIENTATION`
- `OCR_PPSTRUCTURE_USE_TABLE_RECOGNITION`
- `OCR_PPSTRUCTURE_USE_FORMULA_RECOGNITION`
- `OCR_PPSTRUCTURE_USE_CHART_RECOGNITION`
- `OCR_PPSTRUCTURE_USE_REGION_DETECTION`
- `OCR_PPSTRUCTURE_FORMAT_BLOCK_CONTENT`
- `OCR_PPSTRUCTURE_PADDLEX_CONFIG`

镜像构建阶段如果希望预下载模型，可设置：

- Docker build arg：`OCR_PPSTRUCTURE_PRELOAD=1`

默认不预下载，原因是不同架构下 `paddlepaddle` wheel 可用性不一致，强制预下载会直接导致镜像构建失败。

失败诊断说明：

- 主后端会保留 OCR 任务状态
- `ocr-service` 现在会聚合 provider 失败原因，而不是只保留最后一个错误
- 若本地 `PP-StructureV3` 未安装完成，会明确返回依赖缺失，而不是伪装成成功

### 本地依赖与架构限制

`PP-StructureV3` 依赖 `paddleocr[doc-parser] + paddlepaddle`。当前仓库已把以下依赖纳入 `ocr-service`：

- `paddleocr[doc-parser]==3.4.0`
- `paddlepaddle==3.2.0`
- `PyMuPDF`
- `Pillow`
- `numpy`

但需要注意：

- `paddlepaddle` 对不同 CPU 架构的 wheel 支持并不完全一致
- 当前 `requirements.txt` 只对常见可用平台加了直接安装规则
- 如果你的容器平台拿不到对应 wheel，本地 `PP-Structure` 会无法启用，此时应：
  - 切换到受支持架构镜像
  - 或改用远程 OCR provider

### DOCX / XLSX 原生解析建议与现状

当前对 `Word/XLSX` 的建议仍是 **优先走原生 OOXML 解析**，不要像 PDF 一样走渲染型抽取：

- `DOCX`：直接解析 `word/document.xml`、表格结构、段落样式
- `XLSX`：直接解析工作表 XML、共享字符串、样式、合并单元格
- 保留结构化来源回链，便于后续引用到“工作表/单元格”或“逻辑页/表格/单元格”

当前已支持：

- `DOCX` 表格单元格来源回链
- `DOCX` 横向合并 `gridSpan`
- `DOCX` 纵向合并 `vMerge` 的基础还原
- `XLSX` 工作表级来源回链：`工作表[名称]/单元格A1`
- `XLSX` 合并单元格 `rowSpan/colSpan`
- `XLSX` 公式保留：公式文本写入表格单元格来源元数据
- `XLSX` 布尔值、共享字符串、内联字符串基础还原
- `XLSX` 日期样式的保守识别与显示值转换
- `XLSX` 隐藏行/列跳过

当前未做：

- `DOCX` 页级物理定位
- `DOCX` 浮动文本框、批注、修订痕迹完整抽取
- `XLSX` 全量数字格式渲染（目前只保守支持日期类）
- `PPTX` 原生解析

这条路线的优点是：**准确性高、来源清晰、不会像 PDF 那样天然丢结构**。

### MuPDF / PyMuPDF 授权风险

PyMuPDF 底层依赖 MuPDF，整体仍需按 **MuPDF 双许可** 理解：

- 开源许可：`AGPL`
- 商业许可：需单独采购

对当前项目的默认合规假设：

- 若系统用于闭源商用、SaaS、客户交付或其他非开源生产场景，应按**高风险**处理
- 在未完成法务评估或未采购商业授权前，不应默认视为可直接闭源商用
- 当前集成仅表示技术上可用，不代表许可问题已自动解决

如果 PDF 仍无法可靠解码或表格无法稳定提取：

- 不再输出乱码正文
- 会输出解码失败页占位
- 解析状态会降级为失败，而不是伪装成已成功解析

## 常见问题

### 1. 下载返回 401

通常是因为：

- 当前页面没有有效登录令牌
- 令牌未按 `Bearer <token>` 格式发送
- 本地 token 已过期

处理方式：

- 重新登录
- 刷新页面后重试

### 2. PDF 内容是乱码 / 表格识别不稳定

先检查后端环境是否存在 `python3` 与 `PyMuPDF`。若 `PyMuPDF` 可用但仍失败，再看日志中的 `pdfDiagnostics.extractor`、`tableDetector`、`decodeMode` 与 `errors` 字段。
