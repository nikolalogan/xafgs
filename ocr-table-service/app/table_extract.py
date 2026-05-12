from typing import Any
from PIL import ImageEnhance, ImageFilter

from app.table_detect import DocLayoutYoloDetector, get_layout_detector, nms_detections, sort_boxes_top_left
from app.table_extract_shared import (
    BorderTrimOptions,
    DEFAULT_LAYOUT_MODEL,
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
    resolve_layout_model_name,
    resolve_structure_cache_dir,
    resolve_structure_model_name,
)
from app.table_rectify import rectify_table_crop
from app.table_tatr import (
    TableTransformerRecognizer,
    build_table_cells,
    build_table_result,
    get_structure_recognizer,
    make_structure_payload,
    normalize_axis_boxes,
    recognize_best_table_variant,
)

DEFAULT_LAYOUT_MODEL_FILE = "doclayout_yolo_docstructbench_imgsz1024.pt"


def _to_float(payload: dict[str, Any], key: str, default: float, minimum: float | None = None, maximum: float | None = None) -> float:
    raw = payload.get(key)
    value = default if raw is None else float(raw)
    if minimum is not None and value < minimum:
        raise TableExtractError(f"{key} must be >= {minimum}")
    if maximum is not None and value > maximum:
        raise TableExtractError(f"{key} must be <= {maximum}")
    return value


def _to_bool(payload: dict[str, Any], key: str, default: bool) -> bool:
    raw = payload.get(key)
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    raise TableExtractError(f"{key} must be boolean")


def preprocess_page_image(page_image: Any, suppress_red_stamps: bool, enhance_contrast: bool, reduce_noise: bool) -> Any:
    image = page_image
    if suppress_red_stamps:
        red_masked = image.copy()
        pixels = red_masked.load()
        for y in range(red_masked.size[1]):
            for x in range(red_masked.size[0]):
                r, g, b = pixels[x, y]
                if r > 120 and r > (g * 1.2) and r > (b * 1.2):
                    value = int((g + b + 255) / 3)
                    pixels[x, y] = (value, value, value)
        image = red_masked
    if enhance_contrast:
        image = ImageEnhance.Contrast(image).enhance(1.2)
    if reduce_noise:
        image = image.filter(ImageFilter.MedianFilter(size=3))
    return image


def extract_tables(payload: dict[str, Any]) -> dict[str, Any]:
    file = str(payload.get("file") or "").strip()
    if not file:
        raise TableExtractError("file 不能为空")
    file_type = payload.get("fileType")
    if not isinstance(file_type, int):
        file_type = None
    pages_filter = payload.get("pages")
    requested_pages = {int(item) for item in pages_filter if isinstance(item, int) and item > 0} if isinstance(pages_filter, list) else set()
    detection_threshold = _to_float(payload, "detection_threshold", env_float("TABLE_EXTRACT_DETECTOR_THRESHOLD", 0.85), 0.0, 1.0)
    structure_threshold = _to_float(payload, "structure_threshold", env_float("TABLE_EXTRACT_STRUCTURE_THRESHOLD", 0.6), 0.0, 1.0)
    table_crop_padding = _to_float(payload, "table_crop_padding", env_float("TABLE_EXTRACT_CROP_PADDING_PX", 44.0), 0.0, None)
    span_overlap_threshold = _to_float(payload, "span_overlap_threshold", 0.5, 0.0, 1.0)
    use_line_refinement = _to_bool(payload, "use_line_refinement", True)
    row_merge_gap_ratio = _to_float(payload, "row_merge_gap_ratio", 0.44, 0.0, None)
    line_detection_sensitivity = _to_float(payload, "line_detection_sensitivity", 0.56, 0.0, 1.0)
    min_line_support_ratio = _to_float(payload, "min_line_support_ratio", 0.25, 0.0, 1.0)
    use_table_deskew = _to_bool(payload, "use_table_deskew", True)
    deskew_min_angle_deg = _to_float(payload, "deskew_min_angle_deg", 0.2, -10.0, 10.0)
    deskew_max_angle_deg = _to_float(payload, "deskew_max_angle_deg", 5.0, 0.0, 10.0)
    deskew_min_confidence = _to_float(payload, "deskew_min_confidence", 0.45, 0.0, 1.0)
    use_post_sharpen = _to_bool(payload, "use_post_sharpen", True)
    post_sharpen_strength = _to_float(payload, "post_sharpen_strength", 0.25, 0.0, 1.0)
    suppress_red_stamps = _to_bool(payload, "suppress_red_stamps", True)
    enhance_contrast = _to_bool(payload, "enhance_contrast", True)
    reduce_noise = _to_bool(payload, "reduce_noise", True)
    border_trim_options = BorderTrimOptions(
        enabled=True,
        min_projection_ratio=0.1,
        margin_px=3,
        min_size_ratio=0.65,
        max_inset_ratio=0.2,
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
        preprocessed_image = preprocess_page_image(page.image, suppress_red_stamps, enhance_contrast, reduce_noise)
        detections = detector.detect(preprocessed_image, detection_threshold)
        detections = sort_boxes_top_left(nms_detections(detections, 0.35))
        tables: list[dict[str, Any]] = []
        for index, detection in enumerate(detections, start=1):
            candidate_roi_bbox = add_crop_padding(
                normalize_bbox(detection.bbox, page_width, page_height),
                page_width,
                page_height,
                0.0,
                int(round(table_crop_padding)),
            )
            crop_image = preprocessed_image.crop(tuple(candidate_roi_bbox))
            best_variant = rectify_table_crop(
                crop_image,
                candidate_roi_bbox,
                border_trim_options=border_trim_options,
                use_table_deskew=use_table_deskew,
                deskew_min_angle_deg=deskew_min_angle_deg,
                deskew_max_angle_deg=deskew_max_angle_deg,
                deskew_min_confidence=deskew_min_confidence,
                use_post_sharpen=use_post_sharpen,
                post_sharpen_strength=post_sharpen_strength,
            )
            best_variant, structure_items = recognize_best_table_variant(recognizer, [best_variant], structure_threshold)
            tables.append(
                build_table_result(
                    preprocessed_image,
                    page.page_no,
                    index,
                    detection,
                    structure_items,
                    table_variant=best_variant,
                    span_overlap_threshold=span_overlap_threshold,
                    use_line_refinement=use_line_refinement,
                    row_merge_gap_ratio=row_merge_gap_ratio,
                    line_detection_sensitivity=line_detection_sensitivity,
                    min_line_support_ratio=min_line_support_ratio,
                )
            )
            total_tables += 1
        response_pages.append(
            {
                "pageNo": page.page_no,
                "source": page.source,
                "width": page_width,
                "height": page_height,
                "pageImageDataUrl": image_to_data_url(preprocessed_image),
                "tableCount": len(tables),
                "detections": make_structure_payload(detections),
                "tables": tables,
            }
        )
    return {
        "provider": "table-extract-v1",
        "layoutModel": resolve_layout_model_name(),
        "structureModel": resolve_structure_model_name(),
        "detection_threshold": detection_threshold,
        "structure_threshold": structure_threshold,
        "pageCount": len(response_pages),
        "tableCount": total_tables,
        "pages": response_pages,
    }
