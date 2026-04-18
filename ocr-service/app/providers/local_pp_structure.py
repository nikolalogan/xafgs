from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any

from app.models import OCRBlock, OCRCell, OCRLine, OCRPage, OCRResult, OCRTable
from app.providers.base import OCRProvider


class LocalPPStructureProvider(OCRProvider):
    name = "local_pp_structure_v3"

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._pipelines: dict[bool, Any] = {}
        self._pp_structure = None

    def is_configured(self) -> bool:
        return os.getenv("OCR_LOCAL_PPSTRUCTURE_ENABLED", "1").strip() not in {"0", "false", "False"}

    def warmup(self, enable_tables: bool = False) -> None:
        self._get_pipeline(enable_tables=enable_tables)

    def extract(self, content: bytes, file_name: str, mime_type: str, enable_tables: bool) -> OCRResult:
        if not self.is_configured():
            raise RuntimeError("local_pp_structure is disabled")
        input_path = self._write_temp_input(content, file_name, mime_type)
        try:
            pipeline = self._get_pipeline(enable_tables=enable_tables)
            outputs = self._predict_pages(pipeline, input_path)
            if not outputs:
                raise RuntimeError("PP-StructureV3 produced no output")
            pages: list[OCRPage] = []
            page_confidences: list[float] = []
            for page_index, output in enumerate(outputs, start=1):
                json_payload = _extract_result_dict(_read_result_attr(output, "json"))
                markdown_payload = _extract_result_dict(_read_result_attr(output, "markdown"))
                page = self._build_page(
                    page_no=page_index,
                    payload=json_payload,
                    markdown_payload=markdown_payload,
                    enable_tables=enable_tables,
                )
                pages.append(page)
                confidence = self._page_confidence(page, json_payload)
                if confidence > 0:
                    page_confidences.append(confidence)
            return OCRResult(
                provider=self.name,
                pageCount=len(pages),
                confidence=_avg(page_confidences, default=0.0),
                language=os.getenv("OCR_PPSTRUCTURE_LANG", "ch").strip() or "ch",
                pages=pages,
            )
        finally:
            try:
                os.unlink(input_path)
            except FileNotFoundError:
                pass

    def _get_pipeline(self, enable_tables: bool) -> Any:
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
                "use_region_detection": _env_bool("OCR_PPSTRUCTURE_USE_REGION_DETECTION", True),
                "use_table_recognition": enable_tables,
            }
            paddlex_config = os.getenv("OCR_PPSTRUCTURE_PADDLEX_CONFIG", "").strip()
            if paddlex_config:
                init_kwargs["paddlex_config"] = paddlex_config
            pipeline = _create_pp_structure_v3_pipeline(runtime["PPStructureV3"], init_kwargs)
            self._pipelines[enable_tables] = pipeline
            return pipeline

    def _load_runtime(self) -> dict[str, Any]:
        if self._pp_structure is not None:
            return {"PPStructureV3": self._pp_structure}
        with self._lock:
            if self._pp_structure is not None:
                return {"PPStructureV3": self._pp_structure}
            try:
                from paddleocr import PPStructureV3  # type: ignore
            except Exception as exc:
                raise RuntimeError(
                    "PP-StructureV3 runtime is unavailable; install paddleocr[doc-parser] and paddlepaddle first"
                ) from exc
            self._pp_structure = PPStructureV3
            return {"PPStructureV3": self._pp_structure}

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

    @staticmethod
    def _write_temp_input(content: bytes, file_name: str, mime_type: str) -> str:
        suffix = _guess_suffix(file_name, mime_type)
        fd, path = tempfile.mkstemp(prefix="ocr-input-", suffix=suffix)
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
        return path

    def _build_page(self, page_no: int, payload: dict[str, Any], markdown_payload: dict[str, Any], enable_tables: bool) -> OCRPage:
        parsing_res = _ensure_list(payload.get("parsing_res_list"))
        overall_ocr_res = _extract_result_dict(payload.get("overall_ocr_res"))
        lines = self._build_lines(overall_ocr_res)
        blocks: list[OCRBlock] = []
        text_parts: list[str] = []
        for block_no, item in enumerate(parsing_res, start=1):
            if not isinstance(item, dict):
                continue
            label = _normalize_text(str(item.get("block_label") or "")).lower()
            if label == "table" and not enable_tables:
                continue
            text = _normalize_text(str(item.get("block_content") or ""))
            if not text:
                continue
            blocks.append(
                OCRBlock(
                    blockNo=block_no,
                    bbox=_normalize_bbox(item.get("block_bbox")),
                    text=text,
                    lines=lines if block_no == 1 else [],
                )
            )
            text_parts.append(text)

        tables = self._build_tables(payload) if enable_tables else []
        for table in tables:
            for row in table.rows:
                row_text = " | ".join(cell for cell in row if cell)
                normalized = _normalize_text(row_text)
                if normalized:
                    text_parts.append(normalized)

        markdown_text = _first_text(
            markdown_payload.get("markdown_texts"),
            markdown_payload.get("text"),
            markdown_payload.get("markdown"),
        )
        ocr_text = "\n".join(
            _normalize_text(str(item))
            for item in _ensure_list(overall_ocr_res.get("rec_texts"))
            if _normalize_text(str(item))
        )
        page_text = _normalize_text("\n".join(part for part in [markdown_text, ocr_text, "\n".join(text_parts)] if part))
        return OCRPage(
            pageNo=page_no,
            width=_safe_float(payload.get("width")),
            height=_safe_float(payload.get("height")),
            text=page_text,
            blocks=blocks,
            tables=tables,
        )

    @staticmethod
    def _build_lines(overall_ocr_res: dict[str, Any]) -> list[OCRLine]:
        texts = _ensure_list(overall_ocr_res.get("rec_texts"))
        polys = _ensure_list(overall_ocr_res.get("rec_polys"))
        lines: list[OCRLine] = []
        for line_no, text in enumerate(texts, start=1):
            normalized = _normalize_text(str(text))
            if not normalized:
                continue
            bbox = _normalize_bbox(polys[line_no - 1]) if line_no - 1 < len(polys) else []
            lines.append(OCRLine(lineNo=line_no, bbox=bbox, text=normalized))
        return lines

    @staticmethod
    def _build_tables(payload: dict[str, Any]) -> list[OCRTable]:
        raw_tables = _ensure_list(payload.get("table_res_list"))
        tables: list[OCRTable] = []
        for table_no, item in enumerate(raw_tables, start=1):
            if not isinstance(item, dict):
                continue
            ocr_pred = _extract_result_dict(item.get("table_ocr_pred"))
            rec_texts = [_normalize_text(str(text)) for text in _ensure_list(ocr_pred.get("rec_texts"))]
            rec_texts = [text for text in rec_texts if text]
            rec_scores = _ensure_list(ocr_pred.get("rec_scores"))
            boxes = _extract_bbox_list(item.get("cell_box_list"))
            rows = [rec_texts] if rec_texts else []
            cells: list[OCRCell] = []
            for col_index, text in enumerate(rec_texts):
                score = _safe_float(rec_scores[col_index]) if col_index < len(rec_scores) else 0.0
                bbox = boxes[col_index] if col_index < len(boxes) else []
                cells.append(
                    OCRCell(
                        rowIndex=0,
                        colIndex=col_index,
                        rowSpan=1,
                        colSpan=1,
                        text=text,
                        bbox=bbox,
                        confidence=score,
                    )
                )
            tables.append(
                OCRTable(
                    tableNo=table_no,
                    bbox=_normalize_bbox(item.get("block_bbox") or item.get("table_bbox")),
                    headerRowCount=0,
                    rows=rows,
                    cells=cells,
                )
            )
        return tables

    @staticmethod
    def _page_confidence(page: OCRPage, payload: dict[str, Any]) -> float:
        overall_ocr_res = _extract_result_dict(payload.get("overall_ocr_res"))
        ocr_scores = [_safe_float(item) for item in _ensure_list(overall_ocr_res.get("rec_scores")) if _safe_float(item) > 0]
        table_scores: list[float] = []
        for table in page.tables:
            for cell in table.cells:
                if cell.confidence > 0:
                    table_scores.append(cell.confidence)
        scores = ocr_scores + table_scores
        if scores:
            return _avg(scores, default=0.0)
        return 0.86 if page.text else 0.0


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
    if isinstance(value, dict) and isinstance(value.get("res"), dict):
        return value["res"]
    if isinstance(value, dict):
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
        points: list[float] = []
        for point in raw:
            if isinstance(point, list):
                points.extend([_safe_float(item) for item in point[:2]])
        return points
    return [_safe_float(item) for item in raw]


def _normalize_text(value: str) -> str:
    return " ".join((value or "").replace("\xa0", " ").split())


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


def _ensure_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    return value if isinstance(value, list) else []


def _create_pp_structure_v3_pipeline(factory: Any, init_kwargs: dict[str, Any]) -> Any:
    current = dict(init_kwargs)
    fallback_keys = [
        "use_region_detection",
        "use_textline_orientation",
        "use_doc_unwarping",
        "use_doc_orientation_classify",
    ]
    while True:
        try:
            return factory(**current)
        except TypeError:
            if not fallback_keys:
                break
            current.pop(fallback_keys.pop(0), None)
    minimal = {key: value for key, value in init_kwargs.items() if key in {"lang", "device", "use_table_recognition", "paddlex_config"}}
    try:
        return factory(**minimal)
    except TypeError:
        return factory()


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


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _avg(values: list[float], default: float) -> float:
    if not values:
        return default
    return sum(values) / float(len(values))
