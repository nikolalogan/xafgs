import base64
import io
import json
import logging
import os
import re
import time
import uuid
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

import aiohttp
import fitz
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

logger = logging.getLogger("glm_ocr_service")


class LayoutParsingRequest(BaseModel):
    file: str
    fileType: int | None = None
    model: str | None = None
    useTableRecognition: bool | None = True


class MarkdownOCRResponse(BaseModel):
    markdown: str
    text: str
    pages: list[dict[str, Any]]
    provider: str
    model: str
    durationMs: int


class TableCellHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[dict[str, Any]]] = []
        self._current_row: list[dict[str, Any]] | None = None
        self._current_cell: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lower_tag = tag.lower()
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        if lower_tag == "tr":
            self._current_row = []
        elif lower_tag in ("td", "th"):
            self._current_cell = {
                "text": "",
                "rowspan": max(1, int(attr_map.get("rowspan", "1") or "1")),
                "colspan": max(1, int(attr_map.get("colspan", "1") or "1")),
            }

    def handle_endtag(self, tag: str) -> None:
        lower_tag = tag.lower()
        if lower_tag in ("td", "th"):
            if self._current_row is not None and self._current_cell is not None:
                self._current_cell["text"] = normalize_text(self._current_cell.get("text", ""))
                self._current_row.append(self._current_cell)
            self._current_cell = None
            return
        if lower_tag == "tr":
            if self._current_row is not None:
                self.rows.append(self._current_row)
            self._current_row = None

    def handle_data(self, data: str) -> None:
        if self._current_cell is None:
            return
        self._current_cell["text"] += data


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\u00A0", " ")).strip()


def decode_base64_payload(raw: str) -> bytes:
    content = (raw or "").strip()
    if not content:
        raise ValueError("file is empty")
    if "," in content and content.lower().startswith("data:"):
        content = content.split(",", 1)[1]
    return base64.b64decode(content, validate=False)


def render_pdf_pages(raw_bytes: bytes) -> list[bytes]:
    document = fitz.open(stream=raw_bytes, filetype="pdf")
    pages: list[bytes] = []
    try:
        for page_index in range(document.page_count):
            page = document.load_page(page_index)
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            pages.append(pix.tobytes("jpeg"))
    finally:
        document.close()
    return pages


def is_likely_image(raw_bytes: bytes) -> bool:
    if len(raw_bytes) >= 3 and raw_bytes.startswith(b"\xFF\xD8\xFF"):
        return True
    if len(raw_bytes) >= 4 and raw_bytes.startswith(b"\x89PNG"):
        return True
    if len(raw_bytes) >= 4 and raw_bytes.startswith(b"GIF8"):
        return True
    if len(raw_bytes) >= 2 and raw_bytes.startswith(b"BM"):
        return True
    if len(raw_bytes) >= 4 and (raw_bytes.startswith(b"II*\x00") or raw_bytes.startswith(b"MM\x00*")):
        return True
    if len(raw_bytes) >= 12 and raw_bytes[0:4] == b"RIFF" and raw_bytes[8:12] == b"WEBP":
        return True
    return False


def ensure_jpeg(raw_bytes: bytes) -> bytes:
    image = Image.open(io.BytesIO(raw_bytes))
    with io.BytesIO() as buffer:
        image.convert("RGB").save(buffer, format="JPEG", quality=92)
        return buffer.getvalue()


def extract_markdown_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content") or ""
                if isinstance(text, str) and text.strip():
                    chunks.append(text.strip())
            elif isinstance(item, str) and item.strip():
                chunks.append(item.strip())
        return "\n".join(chunks).strip()
    return ""


def build_prompt(markdown_only: bool = False) -> str:
    if markdown_only:
        return (
            "请对图片执行OCR，并只输出可直接嵌入Docling文档结果的Markdown。"
            "保持原始阅读顺序；正文使用自然段；列表使用Markdown列表；"
            "如果存在表格，请优先用HTML <table>...</table> 表示，保留rowspan/colspan。"
            "不要输出代码块包裹，不要添加解释性前后缀。"
        )
    return (
        "请对图片执行OCR与版面解析，输出尽量完整的Markdown文本。"
        "如果存在表格，请优先用HTML <table>...</table> 表示，保留rowspan/colspan。"
        "不要添加解释性前后缀。"
    )


def resolve_auth_mode() -> str:
    raw = (os.getenv("GLM_AUTH_MODE", "auto") or "").strip().lower()
    if raw in ("auto", "none", "bearer"):
        return raw
    return "auto"


def is_official_endpoint(base_url: str) -> bool:
    parsed = urlparse(base_url)
    host = (parsed.hostname or "").lower()
    return host.endswith("open.bigmodel.cn")


def normalize_base_url(value: str) -> str:
    return (value or "").strip().rstrip("/")


def resolve_glm_base_url() -> str:
    base_url = normalize_base_url(os.getenv("GLM_BASE_URL", ""))
    if base_url:
        return base_url
    return "http://vllm:8000"


def parse_error_message(raw: Any) -> str:
    if isinstance(raw, dict):
        err = raw.get("error")
        if isinstance(err, dict):
            code = str(err.get("code") or "").strip()
            message = str(err.get("message") or "").strip()
            if code and message:
                return f"code={code} message={message}"
            if message:
                return message
    return str(raw)


async def is_glm_endpoint_ready(base_url: str, session: aiohttp.ClientSession) -> bool:
    timeout = aiohttp.ClientTimeout(total=3)
    try:
        async with session.get(f"{base_url}/v1/models", timeout=timeout) as response:
            return response.status < 500
    except Exception:
        return False


async def call_glm_ocr(image_bytes: bytes, session: aiohttp.ClientSession, markdown_only: bool = False) -> str:
    base_url = resolve_glm_base_url()
    ready = await is_glm_endpoint_ready(base_url, session)
    if not ready:
        raise RuntimeError(f"项目内 vLLM 服务不可达或未就绪，请检查 {base_url}/v1/models")
    model = (os.getenv("GLM_MODEL", "glm-4.1v-thinking-flash") or "").strip()
    api_key = (os.getenv("GLM_API_KEY", "") or "").strip()
    auth_mode = resolve_auth_mode()
    if auth_mode == "none" and is_official_endpoint(base_url):
        raise RuntimeError("鉴权模式为 none，但 GLM_BASE_URL 指向官方 open.bigmodel.cn，请改为本地地址或启用 bearer")
    endpoint = f"{base_url}/v1/chat/completions"
    image_b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": build_prompt(markdown_only)},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                ],
            }
        ],
    }
    headers = {
        "Content-Type": "application/json",
    }
    use_bearer = auth_mode == "bearer" or (auth_mode == "auto" and api_key)
    if use_bearer:
        if not api_key:
            raise RuntimeError("GLM_AUTH_MODE=bearer 但未配置 GLM_API_KEY")
        headers["Authorization"] = f"Bearer {api_key}"
    timeout_ms = int((os.getenv("GLM_TIMEOUT_MS", "120000") or "120000").strip())
    timeout = aiohttp.ClientTimeout(total=max(5, timeout_ms // 1000))
    try:
        logger.info(
            "glm_ocr_request endpoint=%s model=%s auth_mode=%s use_bearer=%s",
            endpoint,
            model,
            auth_mode,
            use_bearer,
        )
        async with session.post(endpoint, json=payload, headers=headers, timeout=timeout) as response:
            text_body = await response.text()
            try:
                raw = json.loads(text_body) if text_body else {}
            except Exception:
                raw = {"raw": text_body}
            if response.status >= 400:
                message = parse_error_message(raw)
                snippet = (text_body or "")[:300]
                raise RuntimeError(
                    f"GLM request failed status={response.status} endpoint={endpoint} message={message} body={snippet}"
                )
            choices = raw.get("choices") or []
            if not choices:
                raise RuntimeError(f"GLM response missing choices endpoint={endpoint}")
            message = (choices[0] or {}).get("message") or {}
            content = message.get("content")
            text = extract_markdown_text(content)
            if not text:
                raise RuntimeError(f"GLM response content is empty endpoint={endpoint}")
            return text
    except aiohttp.ClientConnectorError as exc:
        raise RuntimeError(f"GLM 服务不可达，请检查项目内 vLLM 容器映射。endpoint={endpoint}, detail={exc}") from exc
    except aiohttp.ClientError as exc:
        raise RuntimeError(f"GLM 请求失败。endpoint={endpoint}, detail={exc}") from exc


def parse_table_html(table_html: str, table_no: int) -> dict[str, Any]:
    parser = TableCellHTMLParser()
    parser.feed(table_html)
    rows = parser.rows
    table_cells: list[dict[str, Any]] = []
    csv_rows: list[list[str]] = []
    for row_index, row in enumerate(rows):
        csv_row: list[str] = []
        col_index = 0
        for cell in row:
            text = normalize_text(cell.get("text", ""))
            rowspan = max(1, int(cell.get("rowspan", 1)))
            colspan = max(1, int(cell.get("colspan", 1)))
            table_cells.append(
                {
                    "rowIndex": row_index,
                    "colIndex": col_index,
                    "rowSpan": rowspan,
                    "colSpan": colspan,
                    "text": text,
                    "bbox": [],
                    "confidence": 0.9,
                }
            )
            csv_row.append(text)
            for _ in range(1, colspan):
                csv_row.append("MERGED")
            col_index += colspan
        csv_rows.append(csv_row)
    return {
        "tableNo": table_no,
        "bbox": [],
        "headerRowCount": 0,
        "rows": csv_rows,
        "csvRows": csv_rows,
        "cells": table_cells,
    }


def build_page_from_markdown(markdown_text: str, page_no: int) -> tuple[dict[str, Any], dict[str, Any]]:
    content = markdown_text.strip()
    table_matches = list(re.finditer(r"<table[\s\S]*?</table>", content, flags=re.IGNORECASE))
    blocks: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    parsing_res_list: list[dict[str, Any]] = []
    cursor = 0
    block_no = 1
    table_no = 1

    for match in table_matches:
        before_text = normalize_text(unescape(content[cursor:match.start()]))
        if before_text:
            blocks.append({"blockNo": block_no, "bbox": [], "text": before_text, "lines": []})
            parsing_res_list.append({"block_label": "text", "block_content": before_text, "block_bbox": []})
            block_no += 1
        table_html = match.group(0).strip()
        table = parse_table_html(table_html, table_no)
        tables.append(table)
        blocks.append({"blockNo": block_no, "bbox": [], "text": table_html, "lines": []})
        parsing_res_list.append({"block_label": "table", "block_content": table_html, "block_bbox": []})
        block_no += 1
        table_no += 1
        cursor = match.end()

    tail_text = normalize_text(unescape(content[cursor:]))
    if tail_text:
        blocks.append({"blockNo": block_no, "bbox": [], "text": tail_text, "lines": []})
        parsing_res_list.append({"block_label": "text", "block_content": tail_text, "block_bbox": []})

    page = {
        "pageNo": page_no,
        "width": 0,
        "height": 0,
        "text": content,
        "blocks": blocks,
        "tables": tables,
    }
    official_item = {
        "prunedResult": {"parsing_res_list": parsing_res_list},
        "markdown": {"text": content},
    }
    return page, official_item


def markdown_to_plain_text(markdown_text: str) -> str:
    content = markdown_text.strip()
    content = re.sub(r"<table[\s\S]*?</table>", lambda match: table_html_to_text(match.group(0)), content, flags=re.IGNORECASE)
    content = re.sub(r"^#{1,6}\s+", "", content, flags=re.MULTILINE)
    content = re.sub(r"^[-*+]\s+", "", content, flags=re.MULTILINE)
    content = re.sub(r"^\d+[.)]\s+", "", content, flags=re.MULTILINE)
    return "\n".join(line.strip() for line in content.splitlines() if line.strip()).strip()


def table_html_to_text(table_html: str) -> str:
    text = re.sub(r"</tr\s*>", "\n", table_html, flags=re.IGNORECASE)
    text = re.sub(r"</t[dh]\s*>", " | ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    rows = []
    for raw_line in text.splitlines():
        row = re.sub(r"\s*\|\s*$", "", raw_line.strip())
        row = re.sub(r"\s+", " ", row)
        if row:
            rows.append(row)
    return "\n".join(rows).strip()


def decode_kserve_image_payload(payload: dict[str, Any]) -> bytes:
    inputs = payload.get("inputs")
    if not isinstance(inputs, list):
        raise ValueError("inputs must be a list")
    for item in inputs:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").lower()
        data = item.get("data")
        if name not in {"image", "images", "input", "file"} and data is None:
            continue
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, str):
                return decode_base64_payload(first)
            if isinstance(first, list):
                return bytes(int(value) for value in first)
        if isinstance(data, str):
            return decode_base64_payload(data)
    raise ValueError("no supported base64 image input found")


def build_kserve_response(markdown_text: str, model_name: str) -> dict[str, Any]:
    plain_text = markdown_to_plain_text(markdown_text)
    return {
        "model_name": model_name,
        "outputs": [
            {
                "name": "text",
                "datatype": "BYTES",
                "shape": [1],
                "data": [plain_text],
            },
            {
                "name": "markdown",
                "datatype": "BYTES",
                "shape": [1],
                "data": [markdown_text],
            },
        ],
    }


app = FastAPI(title="GLM OCR Service", version="1.0.0")


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    base_url = resolve_glm_base_url()
    parsed = urlparse(base_url)
    upstream_ready = False
    upstream_status = ""
    async with aiohttp.ClientSession() as session:
        upstream_ready = await is_glm_endpoint_ready(base_url, session)
        if upstream_ready:
            upstream_status = "ready"
        else:
            upstream_status = "not_ready"
    return {
        "ok": True,
        "provider": "glm-ocr",
        "model": (os.getenv("GLM_MODEL", "glm-4.1v-thinking-flash") or "").strip(),
        "baseHost": (parsed.hostname or ""),
        "upstreamEndpoint": base_url,
        "upstreamReady": upstream_ready,
        "upstreamStatus": upstream_status,
        "authMode": resolve_auth_mode(),
        "isOfficialEndpoint": is_official_endpoint(base_url) if base_url else False,
        "ts": int(time.time()),
    }


@app.post("/layout-parsing")
async def layout_parsing(payload: LayoutParsingRequest) -> dict[str, Any]:
    try:
        raw_bytes = decode_base64_payload(payload.file)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid file payload: {exc}") from exc

    file_type = payload.fileType
    if file_type not in (0, 1):
        file_type = 0 if raw_bytes[:4] == b"%PDF" else 1
    try:
        if file_type == 0:
            images = render_pdf_pages(raw_bytes)
        else:
            images = [ensure_jpeg(raw_bytes)]
    except Exception as exc:
        if file_type == 0 and raw_bytes[:4] != b"%PDF":
            raise HTTPException(status_code=415, detail="unsupported media type: expected pdf when fileType=0") from exc
        if file_type == 1 and not is_likely_image(raw_bytes):
            raise HTTPException(status_code=415, detail="unsupported media type: expected image when fileType=1") from exc
        raise HTTPException(status_code=422, detail=f"decode file failed: {exc}") from exc
    if not images:
        raise HTTPException(status_code=422, detail="no page images extracted")

    pages: list[dict[str, Any]] = []
    official_items: list[dict[str, Any]] = []
    top_tables: list[dict[str, Any]] = []
    async with aiohttp.ClientSession() as session:
        for index, image in enumerate(images):
            try:
                markdown_text = await call_glm_ocr(image, session)
            except Exception as exc:
                logger.exception("layout_parsing_failed page=%s error=%s", index + 1, exc)
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            page, official_item = build_page_from_markdown(markdown_text, index + 1)
            pages.append(page)
            official_items.append(official_item)
            top_tables.extend(page.get("tables") or [])

    return {
        "logId": f"glm-{uuid.uuid4().hex}",
        "errorCode": 0,
        "errorMsg": "",
        "provider": "glm-ocr",
        "pages": pages,
        "tables": top_tables,
        "result": {
            "layoutParsingResults": official_items,
        },
    }


@app.post("/markdown-ocr", response_model=MarkdownOCRResponse)
async def markdown_ocr(payload: LayoutParsingRequest) -> MarkdownOCRResponse:
    started_at = time.perf_counter()
    try:
        raw_bytes = decode_base64_payload(payload.file)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid file payload: {exc}") from exc

    file_type = payload.fileType
    if file_type not in (0, 1):
        file_type = 0 if raw_bytes[:4] == b"%PDF" else 1
    try:
        images = render_pdf_pages(raw_bytes) if file_type == 0 else [ensure_jpeg(raw_bytes)]
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"decode file failed: {exc}") from exc
    if not images:
        raise HTTPException(status_code=422, detail="no page images extracted")

    pages: list[dict[str, Any]] = []
    async with aiohttp.ClientSession() as session:
        for index, image in enumerate(images):
            try:
                markdown_text = await call_glm_ocr(image, session, markdown_only=True)
            except Exception as exc:
                logger.exception("markdown_ocr_failed page=%s error=%s", index + 1, exc)
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            pages.append(
                {
                    "pageNo": index + 1,
                    "markdown": markdown_text,
                    "text": markdown_to_plain_text(markdown_text),
                }
            )

    merged_markdown = "\n\n".join(str(page["markdown"]).strip() for page in pages if str(page["markdown"]).strip())
    return MarkdownOCRResponse(
        markdown=merged_markdown,
        text=markdown_to_plain_text(merged_markdown),
        pages=pages,
        provider="glm-ocr",
        model=(os.getenv("GLM_MODEL", "glm-4.1v-thinking-flash") or "").strip(),
        durationMs=int((time.perf_counter() - started_at) * 1000),
    )


@app.get("/v2")
async def kserve_server_metadata() -> dict[str, Any]:
    return {"name": "glm-ocr", "version": "1.0.0", "extensions": []}


@app.get("/v2/models/{model_name}")
async def kserve_model_metadata(model_name: str) -> dict[str, Any]:
    return {
        "name": model_name,
        "versions": ["1"],
        "platform": "glm-ocr",
        "inputs": [{"name": "image", "datatype": "BYTES", "shape": [-1]}],
        "outputs": [
            {"name": "text", "datatype": "BYTES", "shape": [1]},
            {"name": "markdown", "datatype": "BYTES", "shape": [1]},
        ],
    }


@app.post("/v2/models/{model_name}/infer")
async def kserve_model_infer(model_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        raw_bytes = decode_kserve_image_payload(payload)
        image = ensure_jpeg(raw_bytes)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid kserve image payload: {exc}") from exc
    async with aiohttp.ClientSession() as session:
        try:
            markdown_text = await call_glm_ocr(image, session, markdown_only=True)
        except Exception as exc:
            logger.exception("kserve_glm_ocr_failed model=%s error=%s", model_name, exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    return build_kserve_response(markdown_text, model_name)
