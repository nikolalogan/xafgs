from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import Image

from app.table_extract_shared import (
    STRUCTURE_LABEL_COLUMN,
    STRUCTURE_LABEL_COLUMN_HEADER,
    STRUCTURE_LABEL_PROJECTED_ROW_HEADER,
    STRUCTURE_LABEL_ROW,
    STRUCTURE_LABEL_SPANNING_CELL,
    DetectionBox,
    TableImageVariant,
    bbox_area,
    bbox_center,
    bbox_intersection_ratio,
    bbox_to_polygon,
    image_to_data_url,
    normalize_bbox,
    polygon_to_bbox,
    resolve_structure_cache_dir,
    resolve_structure_local_model_dir,
    resolve_structure_model_name,
    transform_polygon,
    TableExtractError,
)


class TableTransformerRecognizer:
    def __init__(self, model_id: str, cache_dir: str) -> None:
        self.model_id = model_id
        self.cache_dir = cache_dir
        self._processor = None
        self._model = None

    def _load(self) -> tuple[Any, Any]:
        if self._processor is not None and self._model is not None:
            return self._processor, self._model
        local_files_only = Path(self.model_id).is_dir()
        try:
            from transformers import AutoImageProcessor, TableTransformerForObjectDetection
        except Exception as exc:
            raise TableExtractError("Table Transformer 依赖未就绪，请安装 `transformers`、`torch`、`torchvision`") from exc
        try:
            self._processor = AutoImageProcessor.from_pretrained(
                self.model_id,
                cache_dir=self.cache_dir,
                local_files_only=local_files_only,
            )
            self._model = TableTransformerForObjectDetection.from_pretrained(
                self.model_id,
                cache_dir=self.cache_dir,
                local_files_only=local_files_only,
            )
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
        detections: list[DetectionBox] = []
        for bbox, score, label_id in zip(processed["boxes"].tolist(), processed["scores"].tolist(), processed["labels"].tolist()):
            label = str(id2label.get(int(label_id), label_id)).strip().lower()
            detections.append(DetectionBox(label=label, score=float(score), bbox=[float(value) for value in bbox]))
        return detections


@lru_cache(maxsize=1)
def get_structure_recognizer() -> TableTransformerRecognizer:
    model_name = resolve_structure_model_name()
    return TableTransformerRecognizer(
        model_id=resolve_structure_local_model_dir(model_name) or model_name,
        cache_dir=resolve_structure_cache_dir(),
    )


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


def normalize_axis_boxes(boxes: list[DetectionBox], axis: str, crop_width: int, crop_height: int) -> list[DetectionBox]:
    if not boxes:
        return []
    primary_start = 1 if axis == "row" else 0
    primary_end = 3 if axis == "row" else 2
    secondary_start = 0 if axis == "row" else 1
    secondary_end = 2 if axis == "row" else 3
    primary_limit = float(crop_height if axis == "row" else crop_width)
    secondary_limit = float(crop_width if axis == "row" else crop_height)
    ordered = sorted(boxes, key=lambda item: (item.bbox[primary_start], item.bbox[primary_end], item.bbox[secondary_start]))
    normalized: list[DetectionBox] = []
    for item in ordered:
        bbox = [float(value) for value in item.bbox]
        bbox[primary_start] = max(0.0, min(primary_limit, bbox[primary_start]))
        bbox[primary_end] = max(bbox[primary_start], min(primary_limit, bbox[primary_end]))
        bbox[secondary_start] = max(0.0, min(secondary_limit, bbox[secondary_start]))
        bbox[secondary_end] = max(bbox[secondary_start], min(secondary_limit, bbox[secondary_end]))
        normalized.append(DetectionBox(label=item.label, score=item.score, bbox=[round(value, 2) for value in bbox]))
    for index in range(1, len(normalized)):
        previous = normalized[index - 1]
        current = normalized[index]
        previous_end = previous.bbox[primary_end]
        current_start = current.bbox[primary_start]
        if current_start >= previous_end:
            continue
        boundary = round((previous_end + current_start) / 2.0, 2)
        previous_bbox = previous.bbox.copy()
        current_bbox = current.bbox.copy()
        previous_bbox[primary_end] = boundary
        current_bbox[primary_start] = boundary
        normalized[index - 1] = DetectionBox(label=previous.label, score=previous.score, bbox=previous_bbox)
        normalized[index] = DetectionBox(label=current.label, score=current.score, bbox=current_bbox)
    return normalized


def axis_overlap_size(boxes: list[DetectionBox], axis: str) -> float:
    if not boxes:
        return 0.0
    start_index = 1 if axis == "row" else 0
    end_index = 3 if axis == "row" else 2
    ordered = sorted(boxes, key=lambda item: (item.bbox[start_index], item.bbox[end_index]))
    overlap = 0.0
    previous_end = ordered[0].bbox[end_index]
    for item in ordered[1:]:
        overlap += max(0.0, previous_end - item.bbox[start_index])
        previous_end = max(previous_end, item.bbox[end_index])
    return overlap


def score_structure_items(structure_items: list[DetectionBox], width: int, height: int) -> float:
    rows = normalize_axis_boxes(dedupe_axis_boxes([item for item in structure_items if item.label == STRUCTURE_LABEL_ROW], "row"), "row", width, height)
    columns = normalize_axis_boxes(dedupe_axis_boxes([item for item in structure_items if item.label == STRUCTURE_LABEL_COLUMN], "column"), "column", width, height)
    if not rows or not columns:
        return float(len(rows) + len(columns))
    row_coverage = sum(max(0.0, item.bbox[3] - item.bbox[1]) for item in rows) / max(float(height), 1.0)
    column_coverage = sum(max(0.0, item.bbox[2] - item.bbox[0]) for item in columns) / max(float(width), 1.0)
    overlap_penalty = (axis_overlap_size(rows, "row") / max(float(height), 1.0)) + (axis_overlap_size(columns, "column") / max(float(width), 1.0))
    cell_capacity = len(rows) * len(columns)
    return (
        (200.0 if len(rows) >= 2 else 0.0)
        + (200.0 if len(columns) >= 2 else 0.0)
        + min(float(cell_capacity), 120.0)
        + ((row_coverage + column_coverage) * 20.0)
        - (overlap_penalty * 80.0)
    )


def find_indexes_for_span(span_bbox: list[float], boxes: list[DetectionBox], axis: str) -> list[int]:
    indexes: list[int] = []
    span_center = bbox_center(span_bbox)
    for index, item in enumerate(boxes):
        ratio = bbox_intersection_ratio(item.bbox, span_bbox)
        item_center = bbox_center(item.bbox)
        center_in_range = span_bbox[1] <= item_center[1] <= span_bbox[3] if axis == "row" else span_bbox[0] <= item_center[0] <= span_bbox[2]
        span_contains_center = item.bbox[1] <= span_center[1] <= item.bbox[3] if axis == "row" else item.bbox[0] <= span_center[0] <= item.bbox[2]
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
    rows: list[DetectionBox],
    columns: list[DetectionBox],
    column_headers: list[DetectionBox],
    projected_row_headers: list[DetectionBox],
    spanning_cells: list[DetectionBox],
    crop_size: tuple[int, int],
    crop_offset: list[int],
    inverse_matrix: list[list[float]],
    rectified_crop_offset: list[float],
) -> list[dict[str, Any]]:
    if not rows or not columns:
        return []
    crop_width, crop_height = crop_size
    rows = normalize_axis_boxes(rows, "row", crop_width, crop_height)
    columns = normalize_axis_boxes(columns, "column", crop_width, crop_height)
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
        rectified_crop_bbox = [
            round(crop_bbox[0] + rectified_crop_offset[0], 2),
            round(crop_bbox[1] + rectified_crop_offset[1], 2),
            round(crop_bbox[2] + rectified_crop_offset[0], 2),
            round(crop_bbox[3] + rectified_crop_offset[1], 2),
        ]
        page_cell_polygon = [
            [round(point[0] + crop_offset[0], 2), round(point[1] + crop_offset[1], 2)]
            for point in transform_polygon(bbox_to_polygon(rectified_crop_bbox), inverse_matrix)
        ]
        page_cell_bbox = polygon_to_bbox(page_cell_polygon)
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
            "pagePolygon": page_cell_polygon,
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
            crop_bbox = [max(column.bbox[0], 0.0), max(row.bbox[1], 0.0), max(column.bbox[2], 0.0), max(row.bbox[3], 0.0)]
            if bbox_area(crop_bbox) <= 1:
                continue
            occupied[row_index][col_index] = True
            cells.append(build_cell(row_index, row_index, col_index, col_index, min(row.score, column.score)))

    return sorted(cells, key=lambda item: (item["rowIndex"], item["colIndex"]))


def build_table_result(
    page_image: Image.Image,
    page_no: int,
    table_no: int,
    detection: DetectionBox,
    structure_items: list[DetectionBox],
    table_variant: TableImageVariant,
) -> dict[str, Any]:
    page_width, page_height = page_image.size
    table_bbox = normalize_bbox(detection.bbox, page_width, page_height)
    candidate_roi_bbox = table_variant.candidate_roi_bbox
    crop_bbox = normalize_bbox(table_variant.final_crop_bbox, table_variant.image.size[0], table_variant.image.size[1])
    crop_image = table_variant.image
    crop_width, crop_height = crop_image.size
    rows = dedupe_axis_boxes([item for item in structure_items if item.label == STRUCTURE_LABEL_ROW], "row")
    columns = dedupe_axis_boxes([item for item in structure_items if item.label == STRUCTURE_LABEL_COLUMN], "column")
    rows = normalize_axis_boxes(rows, "row", crop_width, crop_height)
    columns = normalize_axis_boxes(columns, "column", crop_width, crop_height)
    column_headers = [item for item in structure_items if item.label == STRUCTURE_LABEL_COLUMN_HEADER]
    projected_row_headers = [item for item in structure_items if item.label == STRUCTURE_LABEL_PROJECTED_ROW_HEADER]
    spanning_cells = [item for item in structure_items if item.label == STRUCTURE_LABEL_SPANNING_CELL]
    cells = build_table_cells(
        rows,
        columns,
        column_headers,
        projected_row_headers,
        spanning_cells,
        crop_size=(crop_width, crop_height),
        crop_offset=[candidate_roi_bbox[0], candidate_roi_bbox[1]],
        inverse_matrix=table_variant.inverse_matrix,
        rectified_crop_offset=table_variant.rectified_crop_offset,
    )
    return {
        "tableId": f"p{page_no}-t{table_no}",
        "pageNo": page_no,
        "tableIndex": table_no,
        "score": round(detection.score, 4),
        "bbox": table_bbox,
        "polygon": bbox_to_polygon(table_bbox),
        "cropBBox": crop_bbox,
        "cropPolygon": bbox_to_polygon(crop_bbox),
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
            "originalCropWidth": table_variant.original_crop_width,
            "originalCropHeight": table_variant.original_crop_height,
            "rectified": bool(table_variant.rectified),
            "rectifyMode": table_variant.rectify_mode,
            "rectifyScale": table_variant.rectify_scale,
            "rectifyInterpolation": table_variant.rectify_interpolation,
            "rectifiedWidth": table_variant.rectified_width,
            "rectifiedHeight": table_variant.rectified_height,
            "borderTrimApplied": table_variant.border_trim_applied,
            "borderTrimBBox": table_variant.border_trim_bbox,
            "borderTrimMarginPx": table_variant.border_trim_margin_px,
            "borderTrimMinProjectionRatio": table_variant.border_trim_min_projection_ratio,
            "rotationApplied": table_variant.rotation_applied,
            "deskewAngle": table_variant.deskew_angle,
            "quadScore": table_variant.quad_score,
            "lineCoverageHorizontal": table_variant.line_coverage_horizontal,
            "lineCoverageVertical": table_variant.line_coverage_vertical,
        },
    }


def recognize_best_table_variant(
    recognizer: TableTransformerRecognizer,
    variants: list[TableImageVariant],
    threshold: float,
) -> tuple[TableImageVariant, list[DetectionBox]]:
    best_variant = variants[0]
    best_items = recognizer.recognize(best_variant.image, threshold)
    best_score = score_structure_items(best_items, best_variant.image.size[0], best_variant.image.size[1])
    for variant in variants[1:]:
        items = recognizer.recognize(variant.image, threshold)
        score = score_structure_items(items, variant.image.size[0], variant.image.size[1])
        if score > best_score:
            best_variant = variant
            best_items = items
            best_score = score
    return best_variant, best_items
