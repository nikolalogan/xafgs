# 报告案例使用说明

## 文件下载

报告案例页面的“已挂接文件”列表支持直接下载附件。

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
