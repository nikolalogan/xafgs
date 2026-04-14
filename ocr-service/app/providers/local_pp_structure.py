from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from app.models import OCRBlock, OCRCell, OCRLine, OCRPage, OCRResult, OCRTable
from app.providers.base import OCRProvider


@dataclass
class ParsedHTMLCell:
    row_index: int
    col_index: int
    text: str
    is_header: bool = False
    row_span: int = 1
    col_span: int = 1


@dataclass
class ParsedHTMLTable:
    rows: list[list[str]] = field(default_factory=list)
    cells: list[ParsedHTMLCell] = field(default_factory=list)
    header_row_count: int = 0


class _SimpleTableHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[ParsedHTMLTable] = []
        self._current_table: ParsedHTMLTable | None = None
        self._current_row: list[str] | None = None
        self._active_cell: dict[str, Any] | None = None
        self._occupied: dict[int, set[int]] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key.lower(): value for key, value in attrs}
        normalized = tag.lower()
        if normalized == "table":
            self._current_table = ParsedHTMLTable()
            self._occupied = {}
            return
        if self._current_table is None:
            return
        if normalized == "tr":
            self._current_row = []
            return
        if normalized not in {"td", "th"} or self._current_row is None:
            return
        row_index = len(self._current_table.rows)
        occupied = self._occupied.setdefault(row_index, set())
        col_index = 0
        while col_index in occupied:
            col_index += 1
        row_span = self._parse_positive_int(attr_map.get("rowspan"))
        col_span = self._parse_positive_int(attr_map.get("colspan"))
        for delta_row in range(row_span):
            row_occupied = self._occupied.setdefault(row_index + delta_row, set())
            for delta_col in range(col_span):
                row_occupied.add(col_index + delta_col)
        self._active_cell = {
            "row_index": row_index,
            "col_index": col_index,
            "row_span": row_span,
            "col_span": col_span,
            "is_header": normalized == "th",
            "chunks": [],
        }

    def handle_endtag(self, tag: str) -> None:
        normalized = tag.lower()
        if normalized == "table":
            if self._current_table is not None:
                self.tables.append(self._current_table)
            self._current_table = None
            self._current_row = None
            self._active_cell = None
            self._occupied = {}
            return
        if self._current_table is None:
            return
        if normalized == "tr":
            if self._current_row is not None:
                self._current_table.rows.append(self._current_row)
            self._current_row = None
            return
        if normalized not in {"td", "th"} or self._active_cell is None or self._current_row is None:
            return
        text = _normalize_text("".join(self._active_cell["chunks"]))
        target_col_index = int(self._active_cell["col_index"])
        while len(self._current_row) < target_col_index:
            self._current_row.append("")
        self._current_row.append(text)
        for _ in range(max(int(self._active_cell["col_span"]) - 1, 0)):
            self._current_row.append("")
        self._current_table.cells.append(
            ParsedHTMLCell(
                row_index=self._active_cell["row_index"],
                col_index=self._active_cell["col_index"],
                text=text,
                is_header=bool(self._active_cell["is_header"]),
                row_span=int(self._active_cell["row_span"]),
                col_span=int(self._active_cell["col_span"]),
            )
        )
        self._active_cell = None

    def handle_data(self, data: str) -> None:
        if self._active_cell is not None:
            self._active_cell["chunks"].append(data)

    @staticmethod
    def _parse_positive_int(raw: str | None) -> int:
        if raw is None:
            return 1
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return 1
        return value if value > 0 else 1


class LocalPPStructureProvider(OCRProvider):
    name = "local_pp_structure_v3"

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._pipelines: dict[bool, Any] = {}
        self._fitz = None
        self._image = None
        self._pp_structure = None

    def is_configured(self) -> bool:
        return os.getenv("OCR_LOCAL_PPSTRUCTURE_ENABLED", "1").strip() not in {"0", "false", "False"}

    def extract(self, content: bytes, file_name: str, mime_type: str, enable_tables: bool) -> OCRResult:
        if not self.is_configured():
            raise RuntimeError("local_pp_structure is disabled")

        input_path = self._write_temp_input(content, file_name, mime_type)
        try:
            meta_pages = self._collect_page_meta(content, file_name, mime_type)
            try:
                pipeline = self._get_pipeline(enable_tables=enable_tables)
            except FileNotFoundError as exc:
                raise RuntimeError(
                    "local_pp_structure_v3 model files are missing (inference.yml not found); "
                    "please set PADDLEX_HOME/OCR_PPSTRUCTURE_MODEL_ROOT and preload models"
                ) from exc
            outputs = self._predict_pages(pipeline, input_path)
            if not outputs:
                raise RuntimeError("PP-StructureV3 produced no output")

            pages: list[OCRPage] = []
            confidences: list[float] = []
            for page_index, output in enumerate(outputs, start=1):
                payload = _extract_result_dict(_read_result_attr(output, "json"))
                markdown_payload = _extract_result_dict(_read_result_attr(output, "markdown"))
                page = self._build_page(
                    page_no=page_index,
                    payload=payload,
                    markdown_payload=markdown_payload,
                    fallback_meta=meta_pages[page_index - 1] if page_index - 1 < len(meta_pages) else {},
                    enable_tables=enable_tables,
                )
                pages.append(page)
                page_confidence = self._page_confidence(page)
                if page_confidence > 0:
                    confidences.append(page_confidence)

            return OCRResult(
                provider=self.name,
                pageCount=len(pages),
                confidence=_avg(confidences, default=0.0),
                language=os.getenv("OCR_PPSTRUCTURE_LANG", "ch").strip() or "ch",
                pages=pages,
            )
        finally:
            try:
                os.unlink(input_path)
            except FileNotFoundError:
                pass

    def _get_pipeline(self, enable_tables: bool):
        with self._lock:
            cached = self._pipelines.get(enable_tables)
            if cached is not None:
                return cached

            runtime = self._load_runtime()
            init_kwargs: dict[str, Any] = {
                "lang": os.getenv("OCR_PPSTRUCTURE_LANG", "ch").strip() or "ch",
                "device": _normalize_device(os.getenv("OCR_PPSTRUCTURE_DEVICE", "cpu")),
                "use_doc_orientation_classify": _env_bool("OCR_PPSTRUCTURE_USE_DOC_ORIENTATION_CLASSIFY", False),
                "use_doc_unwarping": _env_bool("OCR_PPSTRUCTURE_USE_DOC_UNWARPING", False),
                "use_textline_orientation": _env_bool("OCR_PPSTRUCTURE_USE_TEXTLINE_ORIENTATION", False),
                "use_table_recognition": enable_tables,
                "use_formula_recognition": _env_bool("OCR_PPSTRUCTURE_USE_FORMULA_RECOGNITION", False),
                "use_chart_recognition": _env_bool("OCR_PPSTRUCTURE_USE_CHART_RECOGNITION", False),
                "use_region_detection": _env_bool("OCR_PPSTRUCTURE_USE_REGION_DETECTION", True),
                "format_block_content": _env_bool("OCR_PPSTRUCTURE_FORMAT_BLOCK_CONTENT", False),
            }
            paddlex_config = os.getenv("OCR_PPSTRUCTURE_PADDLEX_CONFIG", "").strip()
            if paddlex_config:
                init_kwargs["paddlex_config"] = paddlex_config

            pipeline = _create_pp_structure_v3_pipeline(runtime["PPStructureV3"], init_kwargs)
            self._pipelines[enable_tables] = pipeline
            return pipeline

    def _load_runtime(self) -> dict[str, Any]:
        if self._fitz is not None and self._image is not None and self._pp_structure is not None:
            return {"PPStructureV3": self._pp_structure}
        with self._lock:
            if self._fitz is not None and self._image is not None and self._pp_structure is not None:
                return {"PPStructureV3": self._pp_structure}
            try:
                import fitz  # type: ignore
                from PIL import Image  # type: ignore
                from paddleocr import PPStructureV3  # type: ignore
            except Exception as exc:
                raise RuntimeError(
                    "PP-StructureV3 runtime is unavailable; install paddleocr[doc-parser], paddlepaddle, PyMuPDF and Pillow first"
                ) from exc
            self._fitz = fitz
            self._image = Image
            self._pp_structure = PPStructureV3
        return {"PPStructureV3": self._pp_structure}

    def _write_temp_input(self, content: bytes, file_name: str, mime_type: str) -> str:
        suffix = _guess_suffix(file_name, mime_type)
        fd, path = tempfile.mkstemp(prefix="ocr-input-", suffix=suffix)
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
        return path

    def _collect_page_meta(self, content: bytes, file_name: str, mime_type: str) -> list[dict[str, Any]]:
        self._load_runtime()
        if _is_pdf(file_name, mime_type):
            meta_pages: list[dict[str, Any]] = []
            with self._fitz.open(stream=content, filetype="pdf") as document:
                for page in document:
                    meta_pages.append(
                        {
                            "width": float(page.rect.width),
                            "height": float(page.rect.height),
                        }
                    )
            return meta_pages
        temp_path = _write_temp_image_bytes(content)
        try:
            with self._image.open(temp_path) as opened:
                return [{"width": float(opened.width), "height": float(opened.height)}]
        finally:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass

    @staticmethod
    def _predict_pages(pipeline: Any, input_path: str) -> list[Any]:
        try:
            output = pipeline.predict(input=input_path)
        except TypeError:
            output = pipeline.predict(input_path)
        if output is None:
            return []
        if isinstance(output, list):
            return output
        try:
            return list(output)
        except TypeError:
            return [output]

    def _build_page(
        self,
        page_no: int,
        payload: dict[str, Any],
        markdown_payload: dict[str, Any],
        fallback_meta: dict[str, Any],
        enable_tables: bool,
    ) -> OCRPage:
        parsing_res_list = _ensure_list(payload.get("parsing_res_list"))
        overall_ocr_res = _extract_result_dict(payload.get("overall_ocr_res"))
        table_res_list = _ensure_list(payload.get("table_res_list")) if enable_tables else []

        tables: list[OCRTable] = []
        blocks: list[OCRBlock] = []
        table_region_ids: set[int] = set()
        text_parts: list[str] = []

        for table_index, table_payload in enumerate(table_res_list, start=1):
            if not isinstance(table_payload, dict):
                continue
            table = self._build_table_v3(table_payload, table_index)
            if table is not None:
                tables.append(table)
                text_parts.extend(_flatten_table_rows(table.rows))
                region_id = _safe_int(table_payload.get("table_region_id"))
                if region_id is not None:
                    table_region_ids.add(region_id)

        for block_index, block_payload in enumerate(parsing_res_list, start=1):
            if not isinstance(block_payload, dict):
                continue
            block_id = _safe_int(block_payload.get("block_id"))
            label = _normalize_text(str(block_payload.get("block_label") or "")).lower()
            if label == "table" and block_id is not None and block_id in table_region_ids:
                continue
            block = self._build_block_v3(block_payload, block_index, overall_ocr_res)
            if block is None:
                continue
            blocks.append(block)
            if block.text:
                text_parts.append(block.text)

        markdown_text = _first_text(
            markdown_payload.get("markdown_texts"),
            markdown_payload.get("text"),
            markdown_payload.get("markdown"),
        )
        overall_text = "\n".join(_normalize_text(text) for text in _ensure_list(overall_ocr_res.get("rec_texts")) if _normalize_text(text))
        page_text = _normalize_text("\n".join(part for part in [markdown_text, overall_text, "\n".join(text_parts)] if part))

        return OCRPage(
            pageNo=page_no,
            width=_safe_float(payload.get("width")) or _safe_float(fallback_meta.get("width")),
            height=_safe_float(payload.get("height")) or _safe_float(fallback_meta.get("height")),
            text=page_text,
            blocks=blocks,
            tables=tables,
        )

    def _build_block_v3(self, block_payload: dict[str, Any], block_no: int, overall_ocr_res: dict[str, Any]) -> OCRBlock | None:
        text = _normalize_text(str(block_payload.get("block_content") or ""))
        if not text:
            return None
        lines = self._build_lines_from_overall_ocr(overall_ocr_res)
        return OCRBlock(
            blockNo=block_no,
            bbox=_normalize_bbox(block_payload.get("block_bbox")),
            text=text,
            lines=lines if block_no == 1 else [],
        )

    def _build_table_v3(self, table_payload: dict[str, Any], table_no: int) -> OCRTable | None:
        parsed = _parse_html_table(str(table_payload.get("pred_html") or ""))
        if not parsed.rows and not parsed.cells:
            return None

        table_ocr_pred = _extract_result_dict(table_payload.get("table_ocr_pred"))
        rec_texts = _ensure_list(table_ocr_pred.get("rec_texts"))
        rec_scores = _ensure_list(table_ocr_pred.get("rec_scores"))
        cell_bboxes = _extract_bbox_list(table_payload.get("cell_box_list"))
        rec_bboxes = _extract_bbox_list(table_ocr_pred.get("rec_boxes"))

        cells: list[OCRCell] = []
        for index, parsed_cell in enumerate(parsed.cells):
            bbox = cell_bboxes[index] if index < len(cell_bboxes) else (rec_bboxes[index] if index < len(rec_bboxes) else [])
            text = parsed_cell.text
            if index < len(rec_texts):
                text = _normalize_text(str(rec_texts[index])) or text
            confidence = _safe_float(rec_scores[index]) if index < len(rec_scores) else 0.0
            cells.append(
                OCRCell(
                    rowIndex=parsed_cell.row_index,
                    colIndex=parsed_cell.col_index,
                    rowSpan=parsed_cell.row_span,
                    colSpan=parsed_cell.col_span,
                    text=text,
                    bbox=bbox,
                    confidence=confidence,
                )
            )

        header_row_count = parsed.header_row_count if parsed.header_row_count > 0 else (1 if parsed.rows else 0)
        return OCRTable(
            tableNo=table_no,
            bbox=_normalize_bbox(table_payload.get("block_bbox") or table_payload.get("table_bbox")),
            headerRowCount=header_row_count,
            rows=parsed.rows,
            cells=cells,
        )

    @staticmethod
    def _build_lines_from_overall_ocr(overall_ocr_res: dict[str, Any]) -> list[OCRLine]:
        texts = _ensure_list(overall_ocr_res.get("rec_texts"))
        polys = _ensure_list(overall_ocr_res.get("rec_polys"))
        lines: list[OCRLine] = []
        for index, text in enumerate(texts, start=1):
            normalized = _normalize_text(str(text))
            if not normalized:
                continue
            bbox = _normalize_bbox(polys[index - 1]) if index - 1 < len(polys) else []
            lines.append(OCRLine(lineNo=index, bbox=bbox, text=normalized))
        return lines

    @staticmethod
    def _page_confidence(page: OCRPage) -> float:
        confidences: list[float] = []
        for table in page.tables:
            for cell in table.cells:
                if cell.confidence > 0:
                    confidences.append(cell.confidence)
        for block in page.blocks:
            if block.text:
                confidences.append(0.88)
        return _avg(confidences, default=0.86 if page.text else 0.0)


def _parse_html_table(html: str) -> ParsedHTMLTable:
    parser = _SimpleTableHTMLParser()
    parser.feed(html or "")
    parser.close()
    if not parser.tables:
        return ParsedHTMLTable()
    table = parser.tables[0]
    header_rows = 0
    for row_index, _ in enumerate(table.rows):
        row_cells = [cell for cell in table.cells if cell.row_index == row_index]
        if row_cells and all(cell.is_header for cell in row_cells):
            header_rows += 1
            continue
        break
    table.header_row_count = header_rows
    return table


def _guess_suffix(file_name: str, mime_type: str) -> str:
    if _is_pdf(file_name, mime_type):
        return ".pdf"
    name = (file_name or "").lower()
    for suffix in [".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"]:
        if name.endswith(suffix):
            return suffix
    mime = (mime_type or "").lower()
    if "png" in mime:
        return ".png"
    if "jpeg" in mime or "jpg" in mime:
        return ".jpg"
    return ".bin"


def _is_pdf(file_name: str, mime_type: str) -> bool:
    return (mime_type or "").lower() == "application/pdf" or (file_name or "").lower().endswith(".pdf")


def _read_result_attr(result: Any, attr: str) -> Any:
    value = getattr(result, attr, None)
    if callable(value):
        try:
            value = value()
        except TypeError:
            return {}
    return value


def _extract_result_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    if isinstance(value, dict):
        if isinstance(value.get("res"), dict):
            return value["res"]
        return value
    return {}


def _extract_bbox_list(value: Any) -> list[list[float]]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    if not isinstance(value, list):
        return []
    output: list[list[float]] = []
    for item in value:
        bbox = _normalize_bbox(item)
        if bbox:
            output.append(bbox)
    return output


def _normalize_bbox(raw: Any) -> list[float]:
    if raw is None:
        return []
    if hasattr(raw, "tolist"):
        raw = raw.tolist()
    if not isinstance(raw, list):
        return []
    if raw and isinstance(raw[0], list):
        flattened: list[float] = []
        for point in raw:
            if isinstance(point, list):
                flattened.extend(_safe_float(v) for v in point[:2])
        return flattened
    return [_safe_float(value) for value in raw]


def _normalize_text(value: str) -> str:
    return " ".join((value or "").replace("\xa0", " ").split())


def _ensure_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    return value if isinstance(value, list) else []


def _first_text(*values: Any) -> str:
    for value in values:
        if isinstance(value, str):
            text = _normalize_text(value)
            if text:
                return text
        if isinstance(value, list):
            text = _normalize_text("\n".join(str(item) for item in value if str(item).strip()))
            if text:
                return text
    return ""


def _flatten_table_rows(rows: list[list[str]]) -> list[str]:
    output: list[str] = []
    for row in rows:
        text = " | ".join(_normalize_text(cell) for cell in row if _normalize_text(cell))
        if text:
            output.append(text)
    return output


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip() in {"1", "true", "True", "yes", "on"}


def _normalize_device(raw: str) -> str:
    value = (raw or "cpu").strip().lower()
    if value == "gpu":
        return "gpu:0"
    return value or "cpu"


def _create_pp_structure_v3_pipeline(factory: Any, init_kwargs: dict[str, Any]) -> Any:
    retry_keys = [
        "format_block_content",
        "use_region_detection",
        "use_chart_recognition",
        "use_formula_recognition",
        "use_doc_orientation_classify",
        "use_doc_unwarping",
        "use_textline_orientation",
    ]
    current = dict(init_kwargs)
    while True:
        try:
            return factory(**current)
        except TypeError:
            if not retry_keys:
                break
            current.pop(retry_keys.pop(0), None)
    minimal = {key: value for key, value in init_kwargs.items() if key in {"lang", "device", "use_table_recognition", "paddlex_config"}}
    try:
        return factory(**minimal)
    except TypeError:
        return factory()


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _avg(values: list[float], default: float) -> float:
    if not values:
        return default
    return sum(values) / float(len(values))


def _write_temp_image_bytes(content: bytes) -> str:
    fd, path = tempfile.mkstemp(prefix="ocr-image-", suffix=".bin")
    with os.fdopen(fd, "wb") as handle:
        handle.write(content)
    return path
