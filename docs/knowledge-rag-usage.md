# 文档摘要 + 向量检索（RAG）使用说明

## 1. 目标

本次已实现：

- 基于现有解析能力的异步索引流水线（解析 -> 分块 -> 摘要 -> 向量化 -> 入库）。
- 向量检索接口：`POST /api/knowledge/search`。
- 文件索引运维接口：`POST /api/files/:fileId/reindex`、`GET /api/files/:fileId/index-status`。
- Chat 两段式流程：先检索，再喂模型；无命中时回退到旧附件直读。

---

## 2. API 说明

### 2.1 向量检索

`POST /api/knowledge/search`

请求体：

```json
{
  "query": "请总结项目可研中的核心风险",
  "topK": 12,
  "minScore": 0.2,
  "fileIds": [101, 102],
  "bizKey": "",
  "subjectId": 12,
  "projectId": 88
}
```

返回体（`data`）：

```json
{
  "hits": [
    {
      "fileId": 101,
      "versionNo": 2,
      "chunkIndex": 7,
      "chunkText": "...",
      "chunkSummary": "...",
      "sourceType": "native_text",
      "pageStart": 5,
      "pageEnd": 6,
      "sourceRef": "f101#p5-6#k7",
      "bbox": null,
      "score": 0.83
    }
  ]
}
```

### 2.2 触发重建索引

`POST /api/files/:fileId/reindex?versionNo=2`

### 2.3 查询索引状态

`GET /api/files/:fileId/index-status?versionNo=2`

---

## 3. 范围限定（主体 / 项目）

已支持在检索与聊天中传：

- `subjectId`
- `projectId`

服务端会转换为 `biz_key` 前缀过滤：

- `subject:{subjectId}`
- `project:{projectId}`

> 建议统一上传 `bizKey` 命名规范，确保范围过滤生效：
>
> - 主体资料：`subject:12:xxx`
> - 项目资料：`project:88:xxx`

---

## 4. Chat 两段式流程

已改造成：

1. 先调用知识检索（带 `query + fileIds + subjectId/projectId`）。
2. 将命中片段拼成“证据上下文”喂给模型。
3. 若检索失败或无命中，自动回退旧逻辑（附件直读）。
4. 若开启联网检索（`enableWebSearch=true`），继续融合联网上下文。

聊天请求新增可选字段：

```json
{
  "content": "请给出项目财务可行性判断",
  "enableWebSearch": false,
  "attachments": [{"fileId": 101, "versionNo": 2}],
  "maxContextMessages": 20,
  "subjectId": 12,
  "projectId": 88
}
```

---

## 5. 运行与验证建议

1. 上传文件后，检查是否自动入队索引任务。
2. 调 `index-status` 确认任务 `succeeded`。
3. 调 `knowledge/search` 看是否命中。
4. 调 Chat 接口，验证回复是否体现检索证据语境。

---

## 6. 注意事项

- 当前实现依赖 PostgreSQL + `pgvector` 扩展。
- 检索范围过滤依赖 `biz_key` 前缀约定，请在上传入口保证规范。
- 在受限网络沙箱中无法完成全量 `go test ./...` 依赖拉取验证；需在可联网环境复验。

