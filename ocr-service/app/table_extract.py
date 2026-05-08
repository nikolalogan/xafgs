import base64
import io
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import Image


TABLE_LABEL = "table"
DEFAULT_LAYOUT_MODEL = "juliozhao/DocLayout-YOLO-DocStructBench"
DEFAULT_STRUCTURE_MODEL = "microsoft/table-transformer-structure-recognition-v1.1-pub"
DEFAULT_LAYOUT_MODEL_FILE = "doclayout_yolo_docstructbench_imgsz1024.pt"
STRUCTURE_LABEL_TABLE = "table"
STRUCTURE_LABEL_ROW = "table row"
STRUCTURE_LABEL_COLUMN = "table column"
STRUCTURE_LABEL_COLUMN_HEADER = "table column header"
STRUCTURE_LABEL_PROJECTED_ROW_HEADER = "table projected row header"
STRUCTURE_LABEL_SPANNING_CELL = "table spanning cell"


def env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class DetectionBox:
    label: str
    score: float
    bbox: list[float]


@dataclass(frozen=True)
class PageImage:
    page_no: int
    image: Image.Image
    source: str


class TableExtractError(RuntimeError):
    pass


def resolve_table_extract_cache_root() -> str:
    return os.getenv("TABLE_EXTRACT_MODEL_CACHE_DIR", "/app/model_cache/table_extract").strip()


def resolve_layout_cache_dir() -> str:
    return str(Path(resolve_table_extract_cache_root()) / "layout")


def resolve_structure_cache_dir() -> str:
    return str(Path(resolve_table_extract_cache_root()) / "structure")


def resolve_structure_model_name() -> str:
    return os.getenv("TABLE_EXTRACT_STRUCTURE_MODEL", DEFAULT_STRUCTURE_MODEL).strip()


def resolve_layout_model_name() -> str:
    return os.getenv("TABLE_EXTRACT_LAYOUT_MODEL", DEFAULT_LAYOUT_MODEL).strip()


def resolve_layout_model_file_name() -> str:
    return os.getenv("TABLE_EXTRACT_LAYOUT_MODEL_FILE", DEFAULT_LAYOUT_MODEL_FILE).strip()


def resolve_layout_local_model_path(model_name: str) -> str | None:
    if model_name != DEFAULT_LAYOUT_MODEL:
        return None
    target = Path(resolve_layout_cache_dir()) / resolve_layout_model_file_name()
    if target.is_file():
        return str(target)
    return None


def ensure_layout_model_source(model_name: str) -> str:
    local_model_path = resolve_layout_local_model_path(model_name)
    if local_model_path:
        return local_model_path
    if model_name == DEFAULT_LAYOUT_MODEL:
        raise TableExtractError(
            f"DocLayout-YOLO layout 模型未预热: model={model_name}, cache_dir={resolve_layout_cache_dir()}, "
            f"required_file={resolve_layout_model_file_name()}"
        )
    return model_name


def resolve_structure_local_model_dir(model_name: str) -> str | None:
    if model_name != DEFAULT_STRUCTURE_MODEL:
        return None
    target = Path(resolve_structure_cache_dir())
    required_files = ("config.json", "preprocessor_config.json", "model.safetensors")
    if all((target / name).is_file() for name in required_files):
        return str(target)
    return None


def normalize_bbox(bbox: list[float], width: int, height: int) -> list[float]:
    left, top, right, bottom = bbox
    left = max(0.0, min(float(width), float(left)))
    top = max(0.0, min(float(height), float(top)))
    right = max(left, min(float(width), float(right)))
    bottom = max(top, min(float(height), float(bottom)))
    return [round(left, 2), round(top, 2), round(right, 2), round(bottom, 2)]


def bbox_area(bbox: list[float]) -> float:
    return max(0.0, bbox[2] - bbox[0]) * max(0.0, bbox[3] - bbox[1])


def bbox_center(bbox: list[float]) -> tuple[float, float]:
    return ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)


def bbox_iou(a: list[float], b: list[float]) -> float:
    left = max(a[0], b[0])
    top = max(a[1], b[1])
    right = min(a[2], b[2])
    bottom = min(a[3], b[3])
    inter = bbox_area([left, top, right, bottom])
    if inter <= 0:
        return 0.0
    union = bbox_area(a) + bbox_area(b) - inter
    if union <= 0:
        return 0.0
    return inter / union


def bbox_intersection_ratio(inner: list[float], outer: list[float]) -> float:
    left = max(inner[0], outer[0])
    top = max(inner[1], outer[1])
    right = min(inner[2], outer[2])
    bottom = min(inner[3], outer[3])
    inter = bbox_area([left, top, right, bottom])
    base = bbox_area(inner)
    if inter <= 0 or base <= 0:
        return 0.0
    return inter / base


def bbox_to_polygon(bbox: list[float]) -> list[list[float]]:
    return [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[1]],
        [bbox[2], bbox[3]],
        [bbox[0], bbox[3]],
    ]


def clamp_crop_bbox(bbox: list[float], width: int, height: int) -> list[int]:
    return [
        int(max(0, min(width, round(bbox[0])))),
        int(max(0, min(height, round(bbox[1])))),
        int(max(0, min(width, round(bbox[2])))),
        int(max(0, min(height, round(bbox[3])))),
    ]


def add_crop_padding(bbox: list[float], width: int, height: int, padding_ratio: float, min_padding_px: int) -> list[int]:
    pad_x = max(min_padding_px, int(round((bbox[2] - bbox[0]) * padding_ratio)))
    pad_y = max(min_padding_px, int(round((bbox[3] - bbox[1]) * padding_ratio)))
    padded = [
        bbox[0] - pad_x,
        bbox[1] - pad_y,
        bbox[2] + pad_x,
        bbox[3] + pad_y,
    ]
    return clamp_crop_bbox(padded, width, height)


def image_to_data_url(image: Image.Image, fmt: str = "JPEG", quality: int = 88) -> str:
    mime = "image/jpeg" if fmt.upper() == "JPEG" else f"image/{fmt.lower()}"
    with io.BytesIO() as buffer:
        save_kwargs: dict[str, Any] = {}
        if fmt.upper() == "JPEG":
            save_kwargs["quality"] = quality
        image.save(buffer, format=fmt, **save_kwargs)
        raw = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:{mime};base64,{raw}"


def decode_base64_file(raw: str) -> bytes:
    content = (raw or "").strip()
    if not content:
        raise TableExtractError("file is empty")
    if "," in content and content.lower().startswith("data:"):
        content = content.split(",", 1)[1]
    try:
        return base64.b64decode(content, validate=False)
    except Exception as exc:
        raise TableExtractError(f"invalid base64 payload: {exc}") from exc


def is_probably_pdf(raw_bytes: bytes) -> bool:
    return raw_bytes[:4] == b"%PDF"


def ensure_rgb_image(raw_bytes: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(raw_bytes))
        return image.convert("RGB")
    except Exception as exc:
        raise TableExtractError(f"decode image failed: {exc}") from exc


def render_pdf_to_images(raw_bytes: bytes, scale: float) -> list[PageImage]:
    try:
        import fitz
    except Exception as exc:
        raise TableExtractError("PDF 渲染依赖未就绪，请安装 `PyMuPDF`") from exc
    try:
        document = fitz.open(stream=raw_bytes, filetype="pdf")
    except Exception as exc:
        raise TableExtractError(f"decode pdf failed: {exc}") from exc
    pages: list[PageImage] = []
    try:
        for page_index in range(document.page_count):
            page = document.load_page(page_index)
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            image = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
            pages.append(PageImage(page_no=page_index + 1, image=image, source="pdf"))
    finally:
        document.close()
    return pages


def load_pages(raw_file: str, file_type: int | None) -> list[PageImage]:
    raw_bytes = decode_base64_file(raw_file)
    inferred_file_type = file_type if file_type in (0, 1) else (0 if is_probably_pdf(raw_bytes) else 1)
    if inferred_file_type == 0:
        return render_pdf_to_images(raw_bytes, env_float("TABLE_EXTRACT_PDF_SCALE", 2.0))
    return [PageImage(page_no=1, image=ensure_rgb_image(raw_bytes), source="image")]


class DocLayoutYoloDetector:
    def __init__(self, model_id: str, cache_dir: str, model_source: str) -> None:
        self.model_id = model_id
        self.cache_dir = cache_dir
        self.model_source = model_source
        self._model = None

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        try:
            from doclayout_yolo import YOLOv10
        except Exception as exc:
            raise TableExtractError(
                "DocLayout-YOLO 依赖未就绪，请安装 `doclayout-yolo` 及其运行时依赖"
            ) from exc
        try:
            if Path(self.model_source).is_file():
                self._model = YOLOv10(self.model_source)
            else:
                self._model = YOLOv10.from_pretrained(self.model_source, cache_dir=self.cache_dir)
        except Exception as exc:
            raise TableExtractError(
                f"DocLayout-YOLO 模型加载失败: model={self.model_id}, source={self.model_source}, "
                f"cache_dir={self.cache_dir}, detail={exc}"
            ) from exc
        return self._model

    def detect(self, image: Image.Image, threshold: float) -> list[DetectionBox]:
        model = self._load()
        try:
            result = model.predict(image, conf=threshold, verbose=False)[0]
        except Exception as exc:
            raise TableExtractError(f"DocLayout-YOLO 推理失败: {exc}") from exc
        names = getattr(result, "names", {}) or {}
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            return []
        xyxy_values = boxes.xyxy.tolist()
        conf_values = boxes.conf.tolist()
        cls_values = boxes.cls.tolist()
        detections: list[DetectionBox] = []
        for bbox, score, cls_index in zip(xyxy_values, conf_values, cls_values):
            label = str(names.get(int(cls_index), cls_index)).strip().lower()
            if label != TABLE_LABEL:
                continue
            detections.append(DetectionBox(label=label, score=float(score), bbox=[float(value) for value in bbox]))
        return detections


class TableTransformerRecognizer:
    def __init__(self, model_id: str, cache_dir: str) -> None:
        self.model_id = model_id
        self.cache_dir = cache_dir
        self._processor = None
        self._model = None

    def _load(self) -> tuple[Any, Any]:
        if self._processor is not None and self._model is not None:
            return self._processor, self._model
        try:
            from transformers import AutoImageProcessor, TableTransformerForObjectDetection
        except Exception as exc:
            raise TableExtractError(
                "Table Transformer 依赖未就绪，请安装 `transformers`、`torch`、`torchvision`"
            ) from exc
        try:
            self._processor = AutoImageProcessor.from_pretrained(self.model_id, cache_dir=self.cache_dir)
            self._model = TableTransformerForObjectDetection.from_pretrained(self.model_id, cache_dir=self.cache_dir)
        except Exception as exc:
            raise TableExtractError(
                f"Table Transformer 模型加载失败: model={self.model_id}, cache_dir={self.cache_dir}, detail={exc}"
            ) from exc
        self._model.eval()
        return self._processor, self._model

    def recognize(self, image: Image.Image, threshold: float) -> list[DetectionBox]:
        processor, model = self._load()
        try:
            import torch
        except Exception as exc:
            raise TableExtractError("Table Transformer 依赖未就绪，请安装 `torch`") from exc
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        target_sizes = torch.tensor([[image.height, image.width]])
        processed = processor.post_process_object_detection(outputs, threshold=threshold, target_sizes=target_sizes)[0]
        id2label = getattr(model.config, "id2label", {}) or {}
        boxes = processed["boxes"].tolist()
        scores = processed["scores"].tolist()
        labels = processed["labels"].tolist()
        detections: list[DetectionBox] = []
        for bbox, score, label_id in zip(boxes, scores, labels):
            label = str(id2label.get(int(label_id), label_id)).strip().lower()
            detections.append(DetectionBox(label=label, score=float(score), bbox=[float(value) for value in bbox]))
        return detections


@lru_cache(maxsize=1)
def get_layout_detector() -> DocLayoutYoloDetector:
    model_name = resolve_layout_model_name()
    return DocLayoutYoloDetector(
        model_id=model_name,
        cache_dir=resolve_layout_cache_dir(),
        model_source=ensure_layout_model_source(model_name),
    )


@lru_cache(maxsize=1)
def get_structure_recognizer() -> TableTransformerRecognizer:
    model_name = resolve_structure_model_name()
    return TableTransformerRecognizer(
        model_id=resolve_structure_local_model_dir(model_name) or model_name,
        cache_dir=resolve_structure_cache_dir(),
    )


def nms_detections(detections: list[DetectionBox], iou_threshold: float) -> list[DetectionBox]:
    ordered = sorted(detections, key=lambda item: item.score, reverse=True)
    kept: list[DetectionBox] = []
    while ordered:
        current = ordered.pop(0)
        kept.append(current)
        ordered = [item for item in ordered if bbox_iou(item.bbox, current.bbox) < iou_threshold]
    return kept


def sort_boxes_top_left(boxes: list[DetectionBox]) -> list[DetectionBox]:
    return sorted(boxes, key=lambda item: (round(item.bbox[1] / 8.0), item.bbox[0], item.bbox[1]))


def dedupe_axis_boxes(boxes: list[DetectionBox], axis: str) -> list[DetectionBox]:
    if axis == "row":
        ordered = sorted(boxes, key=lambda item: (item.bbox[1], item.bbox[3], item.bbox[0]))
    else:
        ordered = sorted(boxes, key=lambda item: (item.bbox[0], item.bbox[2], item.bbox[1]))
    merged: list[DetectionBox] = []
    for item in ordered:
        if not merged:
            merged.append(item)
            continue
        previous = merged[-1]
        overlap = bbox_intersection_ratio(item.bbox, previous.bbox)
        current_center = bbox_center(item.bbox)
        previous_center = bbox_center(previous.bbox)
        close_enough = abs(current_center[1] - previous_center[1]) <= 6 if axis == "row" else abs(current_center[0] - previous_center[0]) <= 6
        if overlap >= 0.85 or close_enough:
            merged[-1] = previous if previous.score >= item.score else item
            continue
        merged.append(item)
    return merged


def find_indexes_for_span(span_bbox: list[float], boxes: list[DetectionBox], axis: str) -> list[int]:
    indexes: list[int] = []
    span_center = bbox_center(span_bbox)
    for index, item in enumerate(boxes):
        ratio = bbox_intersection_ratio(item.bbox, span_bbox)
        item_center = bbox_center(item.bbox)
        center_in_range = (
            span_bbox[1] <= item_center[1] <= span_bbox[3] if axis == "row" else span_bbox[0] <= item_center[0] <= span_bbox[2]
        )
        span_contains_center = (
            item.bbox[1] <= span_center[1] <= item.bbox[3] if axis == "row" else item.bbox[0] <= span_center[0] <= item.bbox[2]
        )
        if ratio >= 0.45 or center_in_range or span_contains_center:
            indexes.append(index)
    return indexes


def cell_flags(cell_bbox: list[float], header_boxes: list[DetectionBox], projected_boxes: list[DetectionBox]) -> tuple[bool, bool]:
    is_column_header = any(bbox_intersection_ratio(cell_bbox, box.bbox) >= 0.5 for box in header_boxes)
    is_projected_row_header = any(bbox_intersection_ratio(cell_bbox, box.bbox) >= 0.5 for box in projected_boxes)
    return is_column_header, is_projected_row_header


def make_structure_payload(items: list[DetectionBox]) -> list[dict[str, Any]]:
    return [
        {
            "label": item.label,
            "score": round(item.score, 4),
            "bbox": [round(value, 2) for value in item.bbox],
            "polygon": bbox_to_polygon([round(value, 2) for value in item.bbox]),
        }
        for item in items
    ]


def build_table_cells(
    page_bbox: list[int],
    rows: list[DetectionBox],
    columns: list[DetectionBox],
    column_headers: list[DetectionBox],
    projected_row_headers: list[DetectionBox],
    spanning_cells: list[DetectionBox],
) -> list[dict[str, Any]]:
    if not rows or not columns:
        return []

    occupied = [[False for _ in range(len(columns))] for _ in range(len(rows))]
    cells: list[dict[str, Any]] = []

    def build_cell(row_start: int, row_end: int, col_start: int, col_end: int, score: float) -> dict[str, Any]:
        crop_bbox = [
            rows[row_start].bbox[0] if col_start < 0 else columns[col_start].bbox[0],
            rows[row_start].bbox[1],
            columns[col_end].bbox[2],
            rows[row_end].bbox[3],
        ]
        crop_bbox = [round(value, 2) for value in crop_bbox]
        page_cell_bbox = [
            round(page_bbox[0] + crop_bbox[0], 2),
            round(page_bbox[1] + crop_bbox[1], 2),
            round(page_bbox[0] + crop_bbox[2], 2),
            round(page_bbox[1] + crop_bbox[3], 2),
        ]
        is_column_header, is_projected_row_header = cell_flags(crop_bbox, column_headers, projected_row_headers)
        return {
            "rowIndex": row_start,
            "colIndex": col_start,
            "rowSpan": (row_end - row_start) + 1,
            "colSpan": (col_end - col_start) + 1,
            "confidence": round(score, 4),
            "isColumnHeader": is_column_header,
            "isProjectedRowHeader": is_projected_row_header,
            "pageBBox": page_cell_bbox,
            "pagePolygon": bbox_to_polygon(page_cell_bbox),
            "cropBBox": crop_bbox,
            "cropPolygon": bbox_to_polygon(crop_bbox),
        }

    for span in spanning_cells:
        row_indexes = find_indexes_for_span(span.bbox, rows, "row")
        col_indexes = find_indexes_for_span(span.bbox, columns, "column")
        if not row_indexes or not col_indexes:
            continue
        row_start = min(row_indexes)
        row_end = max(row_indexes)
        col_start = min(col_indexes)
        col_end = max(col_indexes)
        for row_index in range(row_start, row_end + 1):
            for col_index in range(col_start, col_end + 1):
                occupied[row_index][col_index] = True
        cells.append(build_cell(row_start, row_end, col_start, col_end, span.score))

    for row_index, row in enumerate(rows):
        for col_index, column in enumerate(columns):
            if occupied[row_index][col_index]:
                continue
            crop_bbox = [
                max(column.bbox[0], 0.0),
                max(row.bbox[1], 0.0),
                max(column.bbox[2], 0.0),
                max(row.bbox[3], 0.0),
            ]
            if bbox_area(crop_bbox) <= 1:
                continue
            occupied[row_index][col_index] = True
            cells.append(build_cell(row_index, row_index, col_index, col_index, min(row.score, column.score)))

    return sorted(cells, key=lambda item: (item["rowIndex"], item["colIndex"]))


def build_table_result(page_image: Image.Image, page_no: int, table_no: int, detection: DetectionBox, structure_items: list[DetectionBox]) -> dict[str, Any]:
    page_width, page_height = page_image.size
    table_bbox = normalize_bbox(detection.bbox, page_width, page_height)
    crop_bbox = add_crop_padding(
        table_bbox,
        page_width,
        page_height,
        env_float("TABLE_EXTRACT_CROP_PADDING_RATIO", 0.02),
        env_int("TABLE_EXTRACT_CROP_PADDING_MIN_PX", 8),
    )
    crop_image = page_image.crop(tuple(crop_bbox))
    crop_width, crop_height = crop_image.size

    rows = dedupe_axis_boxes([item for item in structure_items if item.label == STRUCTURE_LABEL_ROW], "row")
    columns = dedupe_axis_boxes([item for item in structure_items if item.label == STRUCTURE_LABEL_COLUMN], "column")
    column_headers = [item for item in structure_items if item.label == STRUCTURE_LABEL_COLUMN_HEADER]
    projected_row_headers = [item for item in structure_items if item.label == STRUCTURE_LABEL_PROJECTED_ROW_HEADER]
    spanning_cells = [item for item in structure_items if item.label == STRUCTURE_LABEL_SPANNING_CELL]

    cells = build_table_cells(crop_bbox, rows, columns, column_headers, projected_row_headers, spanning_cells)
    return {
        "tableId": f"p{page_no}-t{table_no}",
        "pageNo": page_no,
        "tableIndex": table_no,
        "score": round(detection.score, 4),
        "bbox": table_bbox,
        "polygon": bbox_to_polygon(table_bbox),
        "cropBBox": crop_bbox,
        "cropPolygon": bbox_to_polygon([float(value) for value in crop_bbox]),
        "tableImageDataUrl": image_to_data_url(crop_image),
        "tableType": "wired" if rows and columns else "wireless",
        "rowCount": len(rows),
        "colCount": len(columns),
        "cells": cells,
        "structures": {
            "rows": make_structure_payload(rows),
            "columns": make_structure_payload(columns),
            "columnHeaders": make_structure_payload(column_headers),
            "projectedRowHeaders": make_structure_payload(projected_row_headers),
            "spanningCells": make_structure_payload(spanning_cells),
            "rawDetections": make_structure_payload(structure_items),
        },
        "meta": {
            "cropWidth": crop_width,
            "cropHeight": crop_height,
        },
    }


def extract_tables(payload: dict[str, Any]) -> dict[str, Any]:
    file = str(payload.get("file") or "").strip()
    if not file:
        raise TableExtractError("file 不能为空")

    file_type = payload.get("fileType")
    if not isinstance(file_type, int):
        file_type = None
    pages_filter = payload.get("pages")
    requested_pages = {int(item) for item in pages_filter if isinstance(item, int) and item > 0} if isinstance(pages_filter, list) else set()
    detector_threshold = float(payload.get("detectorThreshold") or env_float("TABLE_EXTRACT_DETECTOR_THRESHOLD", 0.25))
    structure_threshold = float(payload.get("structureThreshold") or env_float("TABLE_EXTRACT_STRUCTURE_THRESHOLD", 0.35))
    max_tables_per_page = int(payload.get("maxTablesPerPage") or env_int("TABLE_EXTRACT_MAX_TABLES_PER_PAGE", 24))

    pages = load_pages(file, file_type)
    detector = get_layout_detector()
    recognizer = get_structure_recognizer()

    response_pages: list[dict[str, Any]] = []
    total_tables = 0
    for page in pages:
        if requested_pages and page.page_no not in requested_pages:
            continue
        page_width, page_height = page.image.size
        detections = detector.detect(page.image, detector_threshold)
        detections = sort_boxes_top_left(nms_detections(detections, 0.35))[:max_tables_per_page]
        tables: list[dict[str, Any]] = []
        for index, detection in enumerate(detections, start=1):
            crop_bbox = add_crop_padding(
                normalize_bbox(detection.bbox, page_width, page_height),
                page_width,
                page_height,
                env_float("TABLE_EXTRACT_CROP_PADDING_RATIO", 0.02),
                env_int("TABLE_EXTRACT_CROP_PADDING_MIN_PX", 8),
            )
            crop_image = page.image.crop(tuple(crop_bbox))
            structure_items = recognizer.recognize(crop_image, structure_threshold)
            tables.append(build_table_result(page.image, page.page_no, index, detection, structure_items))
            total_tables += 1

        response_pages.append(
            {
                "pageNo": page.page_no,
                "source": page.source,
                "width": page_width,
                "height": page_height,
                "pageImageDataUrl": image_to_data_url(page.image),
                "tableCount": len(tables),
                "detections": make_structure_payload(detections),
                "tables": tables,
            }
        )

    return {
        "provider": "table-extract-v1",
        "layoutModel": resolve_layout_model_name(),
        "structureModel": resolve_structure_model_name(),
        "detectorThreshold": detector_threshold,
        "structureThreshold": structure_threshold,
        "pageCount": len(response_pages),
        "tableCount": total_tables,
        "pages": response_pages,
    }
