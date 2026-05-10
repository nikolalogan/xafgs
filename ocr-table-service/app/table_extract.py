from typing import Any

from app.table_detect import DocLayoutYoloDetector, get_layout_detector, nms_detections, sort_boxes_top_left
from app.table_extract_shared import (
    BorderTrimOptions,
    DEFAULT_LAYOUT_MODEL,
    DEFAULT_LAYOUT_MODEL_FILE,
    DEFAULT_STRUCTURE_MODEL,
    DEFAULT_STRUCTURE_MODEL_FILES,
    DetectionBox,
    PageImage,
    RectifyDetection,
    TableExtractError,
    TableImageVariant,
    add_crop_padding,
    ensure_layout_model_source,
    env_bool,
    env_float,
    env_int,
    image_to_data_url,
    load_pages,
    normalize_bbox,
    resolve_layout_cache_dir,
    resolve_layout_model_file_name,
    resolve_layout_model_name,
    resolve_structure_cache_dir,
    resolve_structure_model_name,
)
from app.table_rectify import build_table_image_variants, detect_table_quad, rectify_table_crop, rotate_table_variant_clockwise
from app.table_tatr import (
    TableTransformerRecognizer,
    build_table_cells,
    build_table_result,
    get_structure_recognizer,
    make_structure_payload,
    normalize_axis_boxes,
    recognize_best_table_variant,
)


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
    border_trim_options = BorderTrimOptions(
        enabled=bool(payload.get("borderTrimEnabled")) if isinstance(payload.get("borderTrimEnabled"), bool) else env_bool("TABLE_EXTRACT_BORDER_TRIM_ENABLED", True),
        min_projection_ratio=float(payload.get("borderTrimMinProjectionRatio") or env_float("TABLE_EXTRACT_BORDER_TRIM_MIN_PROJECTION_RATIO", 0.1)),
        margin_px=int(payload.get("borderTrimMarginPx") or env_int("TABLE_EXTRACT_BORDER_TRIM_MARGIN_PX", 3)),
        min_size_ratio=float(payload.get("borderTrimMinSizeRatio") or env_float("TABLE_EXTRACT_BORDER_TRIM_MIN_SIZE_RATIO", 0.65)),
        max_inset_ratio=float(payload.get("borderTrimMaxInsetRatio") or env_float("TABLE_EXTRACT_BORDER_TRIM_MAX_INSET_RATIO", 0.2)),
    )
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
            candidate_roi_bbox = add_crop_padding(
                normalize_bbox(detection.bbox, page_width, page_height),
                page_width,
                page_height,
                env_float("TABLE_EXTRACT_CROP_PADDING_RATIO", 0.02),
                env_int("TABLE_EXTRACT_CROP_PADDING_MIN_PX", 8),
            )
            crop_image = page.image.crop(tuple(candidate_roi_bbox))
            variants = build_table_image_variants(crop_image, candidate_roi_bbox, border_trim_options)
            best_variant, structure_items = recognize_best_table_variant(recognizer, variants, structure_threshold)
            tables.append(build_table_result(page.image, page.page_no, index, detection, structure_items, table_variant=best_variant))
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
