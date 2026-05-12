from typing import Any

from PIL import Image

from app.table_extract_shared import (
    BorderTrimOptions,
    RectifyDetection,
    TableImageVariant,
    clamp_crop_bbox,
    env_float,
    env_int,
    env_str,
    full_crop_bbox,
    identity_matrix,
    load_cv2,
    matrix_inverse,
    matrix_multiply,
    polygon_area,
    sort_quad_points,
    transform_polygon,
)


DEFAULT_RECTIFY_SCALE = 1.5
DEFAULT_RECTIFY_MAX_EDGE = 4096
DEFAULT_RECTIFY_INTERPOLATION = "lanczos4"
DEFAULT_LINE_MASK_BLUR = 5
DEFAULT_LINE_MASK_BLOCK_SIZE = 31
DEFAULT_LINE_MASK_THRESHOLD_C = 15
DEFAULT_LINE_MASK_KERNEL_DIVISOR = 18
DEFAULT_LINE_MASK_KERNEL_MIN = 12
DEFAULT_BORDER_TRIM_ENABLED = True
DEFAULT_BORDER_TRIM_MIN_PROJECTION_RATIO = 0.1
DEFAULT_BORDER_TRIM_MARGIN_PX = 3
DEFAULT_BORDER_TRIM_MIN_SIZE_RATIO = 0.65
DEFAULT_BORDER_TRIM_MAX_INSET_RATIO = 0.2


def resolve_rectify_scale() -> float:
    return max(1.0, min(env_float("TABLE_EXTRACT_RECTIFY_SCALE", DEFAULT_RECTIFY_SCALE), 4.0))


def resolve_rectify_max_edge() -> int:
    return max(64, env_int("TABLE_EXTRACT_RECTIFY_MAX_EDGE", DEFAULT_RECTIFY_MAX_EDGE))


def resolve_rectify_interpolation() -> tuple[str, int]:
    cv2, _ = load_cv2()
    name = env_str("TABLE_EXTRACT_RECTIFY_INTERPOLATION", DEFAULT_RECTIFY_INTERPOLATION).strip().lower()
    mapping = {
        "nearest": cv2.INTER_NEAREST,
        "linear": cv2.INTER_LINEAR,
        "cubic": cv2.INTER_CUBIC,
        "area": cv2.INTER_AREA,
        "lanczos4": cv2.INTER_LANCZOS4,
    }
    return (name if name in mapping else DEFAULT_RECTIFY_INTERPOLATION), mapping.get(name, cv2.INTER_LANCZOS4)


def resolve_default_border_trim_options() -> BorderTrimOptions:
    from app.table_extract_shared import env_bool

    return BorderTrimOptions(
        enabled=env_bool("TABLE_EXTRACT_BORDER_TRIM_ENABLED", DEFAULT_BORDER_TRIM_ENABLED),
        min_projection_ratio=max(0.01, min(env_float("TABLE_EXTRACT_BORDER_TRIM_MIN_PROJECTION_RATIO", DEFAULT_BORDER_TRIM_MIN_PROJECTION_RATIO), 0.5)),
        margin_px=max(0, env_int("TABLE_EXTRACT_BORDER_TRIM_MARGIN_PX", DEFAULT_BORDER_TRIM_MARGIN_PX)),
        min_size_ratio=max(0.2, min(env_float("TABLE_EXTRACT_BORDER_TRIM_MIN_SIZE_RATIO", DEFAULT_BORDER_TRIM_MIN_SIZE_RATIO), 1.0)),
        max_inset_ratio=max(0.02, min(env_float("TABLE_EXTRACT_BORDER_TRIM_MAX_INSET_RATIO", DEFAULT_BORDER_TRIM_MAX_INSET_RATIO), 0.45)),
    )


def compute_rectified_size(width: float, height: float) -> tuple[int, int, float]:
    base_width = max(1.0, width)
    base_height = max(1.0, height)
    scale = resolve_rectify_scale()
    max_edge = resolve_rectify_max_edge()
    target_width = base_width * scale
    target_height = base_height * scale
    longest_edge = max(target_width, target_height)
    if longest_edge > float(max_edge):
        clamp_ratio = float(max_edge) / longest_edge
        target_width *= clamp_ratio
        target_height *= clamp_ratio
    return max(1, int(round(target_width))), max(1, int(round(target_height))), scale


def estimate_line_coverage(mask: Any, axis: str) -> float:
    _, np = load_cv2()
    height, width = mask.shape[:2]
    if height <= 0 or width <= 0:
        return 0.0
    counts = np.count_nonzero(mask > 0, axis=1 if axis == "horizontal" else 0)
    limit = width if axis == "horizontal" else height
    if limit <= 0:
        return 0.0
    active = np.count_nonzero(counts >= max(4, int(round(limit * 0.1))))
    base = height if axis == "horizontal" else width
    return round(float(active) / max(float(base), 1.0), 4)


def find_projection_bounds(mask: Any, axis: str, min_ratio: float) -> tuple[int, int] | None:
    _, np = load_cv2()
    height, width = mask.shape[:2]
    counts = np.count_nonzero(mask > 0, axis=1 if axis == "horizontal" else 0)
    limit = width if axis == "horizontal" else height
    threshold = max(4, int(round(limit * min_ratio)))
    indexes = np.where(counts >= threshold)[0]
    if indexes.size == 0:
        return None
    return int(indexes[0]), int(indexes[-1])


def trim_table_border(image: Image.Image, options: BorderTrimOptions) -> tuple[Image.Image, list[float], bool]:
    if not options.enabled:
        return image, full_crop_bbox(image.size[0], image.size[1]), False
    horizontal, vertical = build_table_line_masks(image)
    horizontal_coverage = estimate_line_coverage(horizontal, "horizontal")
    vertical_coverage = estimate_line_coverage(vertical, "vertical")
    if horizontal_coverage <= 0.0 or vertical_coverage <= 0.0:
        return image, full_crop_bbox(image.size[0], image.size[1]), False
    top_bottom = find_projection_bounds(horizontal, "horizontal", options.min_projection_ratio)
    left_right = find_projection_bounds(vertical, "vertical", options.min_projection_ratio)
    if top_bottom is None or left_right is None:
        return image, full_crop_bbox(image.size[0], image.size[1]), False
    left, right = left_right
    top, bottom = top_bottom
    width, height = image.size
    if right <= left or bottom <= top:
        return image, full_crop_bbox(width, height), False
    trimmed = clamp_crop_bbox(
        [
            float(left - options.margin_px),
            float(top - options.margin_px),
            float(right + options.margin_px + 1),
            float(bottom + options.margin_px + 1),
        ],
        width,
        height,
    )
    trim_width = trimmed[2] - trimmed[0]
    trim_height = trimmed[3] - trimmed[1]
    if trim_width <= 1 or trim_height <= 1:
        return image, full_crop_bbox(width, height), False
    if (trim_width / max(width, 1)) < options.min_size_ratio or (trim_height / max(height, 1)) < options.min_size_ratio:
        return image, full_crop_bbox(width, height), False
    if (trimmed[0] / max(width, 1)) > options.max_inset_ratio:
        return image, full_crop_bbox(width, height), False
    if ((width - trimmed[2]) / max(width, 1)) > options.max_inset_ratio:
        return image, full_crop_bbox(width, height), False
    if (trimmed[1] / max(height, 1)) > options.max_inset_ratio:
        return image, full_crop_bbox(width, height), False
    if ((height - trimmed[3]) / max(height, 1)) > options.max_inset_ratio:
        return image, full_crop_bbox(width, height), False
    crop_box = [float(trimmed[0]), float(trimmed[1]), float(trimmed[2]), float(trimmed[3])]
    trimmed_image = image.crop(tuple(trimmed))
    return trimmed_image, crop_box, True


def build_trimmed_variant(
    image: Image.Image,
    candidate_roi_bbox: list[int],
    base_variant: TableImageVariant,
    border_trim_options: BorderTrimOptions,
) -> TableImageVariant:
    trimmed_image, trim_bbox, applied = trim_table_border(base_variant.image, border_trim_options)
    if not applied:
        return TableImageVariant(
            image=base_variant.image,
            candidate_roi_bbox=candidate_roi_bbox,
            final_crop_bbox=full_crop_bbox(base_variant.image.size[0], base_variant.image.size[1]),
            roi_quad=base_variant.roi_quad,
            forward_matrix=base_variant.forward_matrix,
            inverse_matrix=base_variant.inverse_matrix,
            rectified=base_variant.rectified,
            rectify_mode=base_variant.rectify_mode,
            rotation_applied=base_variant.rotation_applied,
            original_crop_width=base_variant.original_crop_width,
            original_crop_height=base_variant.original_crop_height,
            deskew_angle=base_variant.deskew_angle,
            quad_score=base_variant.quad_score,
            line_coverage_horizontal=base_variant.line_coverage_horizontal,
            line_coverage_vertical=base_variant.line_coverage_vertical,
            rectify_scale=base_variant.rectify_scale,
            rectify_interpolation=base_variant.rectify_interpolation,
            rectified_width=base_variant.rectified_width,
            rectified_height=base_variant.rectified_height,
            rectified_crop_offset=base_variant.rectified_crop_offset,
            border_trim_applied=False,
            border_trim_bbox=None,
            border_trim_margin_px=border_trim_options.margin_px,
            border_trim_min_projection_ratio=border_trim_options.min_projection_ratio,
        )
    return TableImageVariant(
        image=trimmed_image,
        candidate_roi_bbox=candidate_roi_bbox,
        final_crop_bbox=full_crop_bbox(trimmed_image.size[0], trimmed_image.size[1]),
        roi_quad=base_variant.roi_quad,
        forward_matrix=base_variant.forward_matrix,
        inverse_matrix=base_variant.inverse_matrix,
        rectified=base_variant.rectified,
        rectify_mode=base_variant.rectify_mode,
        rotation_applied=base_variant.rotation_applied,
        original_crop_width=base_variant.original_crop_width,
        original_crop_height=base_variant.original_crop_height,
        deskew_angle=base_variant.deskew_angle,
        quad_score=base_variant.quad_score,
        line_coverage_horizontal=base_variant.line_coverage_horizontal,
        line_coverage_vertical=base_variant.line_coverage_vertical,
        rectify_scale=base_variant.rectify_scale,
        rectify_interpolation=base_variant.rectify_interpolation,
        rectified_width=base_variant.rectified_width,
        rectified_height=base_variant.rectified_height,
        rectified_crop_offset=[
            base_variant.rectified_crop_offset[0] + trim_bbox[0],
            base_variant.rectified_crop_offset[1] + trim_bbox[1],
        ],
        border_trim_applied=True,
        border_trim_bbox=trim_bbox,
        border_trim_margin_px=border_trim_options.margin_px,
        border_trim_min_projection_ratio=border_trim_options.min_projection_ratio,
    )


def rotate_matrix_clockwise(width: int, height: int) -> list[list[float]]:
    return [
        [0.0, -1.0, float(height)],
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
    ]


def rotation_matrix(angle_degrees: float, width: int, height: int) -> list[list[float]]:
    cv2, _ = load_cv2()
    center = (float(width) / 2.0, float(height) / 2.0)
    affine = cv2.getRotationMatrix2D(center, angle_degrees, 1.0)
    return [
        [float(affine[0][0]), float(affine[0][1]), float(affine[0][2])],
        [float(affine[1][0]), float(affine[1][1]), float(affine[1][2])],
        [0.0, 0.0, 1.0],
    ]


def warp_affine_image(image: Image.Image, matrix: list[list[float]]) -> Image.Image:
    cv2, np = load_cv2()
    source = np.array(image)
    if source.ndim == 2:
        source = cv2.cvtColor(source, cv2.COLOR_GRAY2RGB)
    elif source.shape[2] == 4:
        source = cv2.cvtColor(source, cv2.COLOR_RGBA2RGB)
    affine = np.array(matrix[:2], dtype=np.float32)
    _, interpolation = resolve_rectify_interpolation()
    warped = cv2.warpAffine(source, affine, image.size, flags=interpolation, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(warped)


def apply_post_sharpen(image: Image.Image, strength: float) -> Image.Image:
    cv2, np = load_cv2()
    source = np.array(image)
    kernel = np.array([[0.0, -1.0, 0.0], [-1.0, 5.0 + max(0.0, min(1.0, strength)), -1.0], [0.0, -1.0, 0.0]], dtype=np.float32)
    sharpened = cv2.filter2D(source, ddepth=-1, kernel=kernel, borderType=cv2.BORDER_REPLICATE)
    return Image.fromarray(sharpened)


def warp_perspective_image(
    image: Image.Image, quad: list[list[float]]
) -> tuple[Image.Image, list[list[float]], list[list[float]], float, str, int, int]:
    cv2, np = load_cv2()
    source = np.array(image)
    if source.ndim == 2:
        source = cv2.cvtColor(source, cv2.COLOR_GRAY2RGB)
    elif source.shape[2] == 4:
        source = cv2.cvtColor(source, cv2.COLOR_RGBA2RGB)
    points = np.array(quad, dtype=np.float32)
    width_top = float(((points[1][0] - points[0][0]) ** 2 + (points[1][1] - points[0][1]) ** 2) ** 0.5)
    width_bottom = float(((points[2][0] - points[3][0]) ** 2 + (points[2][1] - points[3][1]) ** 2) ** 0.5)
    height_left = float(((points[3][0] - points[0][0]) ** 2 + (points[3][1] - points[0][1]) ** 2) ** 0.5)
    height_right = float(((points[2][0] - points[1][0]) ** 2 + (points[2][1] - points[1][1]) ** 2) ** 0.5)
    target_width, target_height, rectify_scale = compute_rectified_size(max(width_top, width_bottom), max(height_left, height_right))
    destination = np.array(
        [
            [0.0, 0.0],
            [float(target_width - 1), 0.0],
            [float(target_width - 1), float(target_height - 1)],
            [0.0, float(target_height - 1)],
        ],
        dtype=np.float32,
    )
    forward = cv2.getPerspectiveTransform(points, destination)
    inverse = cv2.getPerspectiveTransform(destination, points)
    interpolation_name, interpolation = resolve_rectify_interpolation()
    warped = cv2.warpPerspective(source, forward, (target_width, target_height), flags=interpolation, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(warped), forward.tolist(), inverse.tolist(), rectify_scale, interpolation_name, target_width, target_height


def build_table_line_masks(image: Image.Image) -> tuple[Any, Any]:
    cv2, np = load_cv2()
    rgb = np.array(image)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blur_size = max(1, env_int("TABLE_EXTRACT_LINE_MASK_BLUR", DEFAULT_LINE_MASK_BLUR))
    if blur_size % 2 == 0:
        blur_size += 1
    block_size = max(3, env_int("TABLE_EXTRACT_LINE_MASK_BLOCK_SIZE", DEFAULT_LINE_MASK_BLOCK_SIZE))
    if block_size % 2 == 0:
        block_size += 1
    threshold_c = env_int("TABLE_EXTRACT_LINE_MASK_THRESHOLD_C", DEFAULT_LINE_MASK_THRESHOLD_C)
    kernel_divisor = max(1, env_int("TABLE_EXTRACT_LINE_MASK_KERNEL_DIVISOR", DEFAULT_LINE_MASK_KERNEL_DIVISOR))
    kernel_min = max(1, env_int("TABLE_EXTRACT_LINE_MASK_KERNEL_MIN", DEFAULT_LINE_MASK_KERNEL_MIN))
    gray = cv2.GaussianBlur(gray, (blur_size, blur_size), 0)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, block_size, threshold_c)
    height, width = gray.shape[:2]
    horizontal_size = max(kernel_min, width // kernel_divisor)
    vertical_size = max(kernel_min, height // kernel_divisor)
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (horizontal_size, 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, vertical_size))
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)
    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel)
    return horizontal, vertical


def estimate_table_deskew_angle(horizontal: Any, vertical: Any) -> float:
    cv2, np = load_cv2()
    lines = cv2.HoughLinesP(
        cv2.add(horizontal, vertical),
        1,
        np.pi / 180.0,
        threshold=40,
        minLineLength=max(20, min(horizontal.shape[:2]) // 4),
        maxLineGap=12,
    )
    if lines is None:
        return 0.0
    horizontal_angles: list[float] = []
    vertical_angles: list[float] = []
    for line in lines[:, 0]:
        x1, y1, x2, y2 = [float(value) for value in line]
        angle = float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        if abs(angle) <= 25.0:
            horizontal_angles.append(angle)
        elif abs(abs(angle) - 90.0) <= 25.0:
            vertical_angles.append(angle - 90.0 if angle > 0 else angle + 90.0)
    candidates = horizontal_angles if len(horizontal_angles) >= len(vertical_angles) else vertical_angles
    if not candidates:
        return 0.0
    return round(max(-20.0, min(20.0, float(np.median(np.array(candidates, dtype=np.float32))))), 4)


def score_rectified_quad(
    quad: list[list[float]],
    image_width: int,
    image_height: int,
    line_coverage_horizontal: float,
    line_coverage_vertical: float,
) -> float:
    width_top = ((quad[1][0] - quad[0][0]) ** 2 + (quad[1][1] - quad[0][1]) ** 2) ** 0.5
    width_bottom = ((quad[2][0] - quad[3][0]) ** 2 + (quad[2][1] - quad[3][1]) ** 2) ** 0.5
    height_left = ((quad[3][0] - quad[0][0]) ** 2 + (quad[3][1] - quad[0][1]) ** 2) ** 0.5
    height_right = ((quad[2][0] - quad[1][0]) ** 2 + (quad[2][1] - quad[1][1]) ** 2) ** 0.5
    area_ratio = polygon_area(quad) / max(float(image_width * image_height), 1.0)
    width_balance = min(width_top, width_bottom) / max(max(width_top, width_bottom), 1.0)
    height_balance = min(height_left, height_right) / max(max(height_left, height_right), 1.0)
    coverage_score = min(1.0, (line_coverage_horizontal + line_coverage_vertical) / 0.25)
    return round((area_ratio * 0.45) + (width_balance * 0.2) + (height_balance * 0.2) + (coverage_score * 0.15), 4)


def detect_table_quad(image: Image.Image) -> RectifyDetection:
    horizontal, vertical = build_table_line_masks(image)
    line_coverage_horizontal = estimate_line_coverage(horizontal, "horizontal")
    line_coverage_vertical = estimate_line_coverage(vertical, "vertical")
    if (line_coverage_horizontal + line_coverage_vertical) < 0.03:
        return RectifyDetection("fallback_none", None, 0.0, 0.0, line_coverage_horizontal, line_coverage_vertical)
    deskew_angle = estimate_table_deskew_angle(horizontal, vertical)
    deskew_matrix = rotation_matrix(-deskew_angle, image.size[0], image.size[1]) if abs(deskew_angle) >= 0.2 else identity_matrix()
    deskewed_image = warp_affine_image(image, deskew_matrix) if deskew_matrix != identity_matrix() else image
    rotated_horizontal, rotated_vertical = build_table_line_masks(deskewed_image)
    rotated_horizontal_coverage = estimate_line_coverage(rotated_horizontal, "horizontal")
    rotated_vertical_coverage = estimate_line_coverage(rotated_vertical, "vertical")
    top_bottom = find_projection_bounds(rotated_horizontal, "horizontal", 0.1)
    left_right = find_projection_bounds(rotated_vertical, "vertical", 0.1)
    if top_bottom is None or left_right is None:
        mode = "deskew_only" if abs(deskew_angle) >= 0.2 else "fallback_none"
        return RectifyDetection(mode, None, deskew_angle, 0.0, rotated_horizontal_coverage, rotated_vertical_coverage)
    left, right = left_right
    top, bottom = top_bottom
    if right <= left or bottom <= top:
        mode = "deskew_only" if abs(deskew_angle) >= 0.2 else "fallback_none"
        return RectifyDetection(mode, None, deskew_angle, 0.0, rotated_horizontal_coverage, rotated_vertical_coverage)
    deskew_quad = sort_quad_points(
        [
            [float(left), float(top)],
            [float(right), float(top)],
            [float(right), float(bottom)],
            [float(left), float(bottom)],
        ]
    )
    original_quad = sort_quad_points(transform_polygon(deskew_quad, matrix_inverse(deskew_matrix)))
    quad_score = score_rectified_quad(
        original_quad,
        image.size[0],
        image.size[1],
        rotated_horizontal_coverage,
        rotated_vertical_coverage,
    )
    if quad_score < 0.35:
        mode = "deskew_only" if abs(deskew_angle) >= 0.2 else "fallback_none"
        return RectifyDetection(mode, None, deskew_angle, quad_score, rotated_horizontal_coverage, rotated_vertical_coverage)
    return RectifyDetection("line_quad", original_quad, deskew_angle, quad_score, rotated_horizontal_coverage, rotated_vertical_coverage)


def rectify_table_crop(
    image: Image.Image,
    candidate_roi_bbox: list[int],
    border_trim_options: BorderTrimOptions | None = None,
    use_table_deskew: bool = True,
    deskew_min_angle_deg: float = 0.2,
    deskew_max_angle_deg: float = 5.0,
    deskew_min_confidence: float = 0.45,
    use_post_sharpen: bool = True,
    post_sharpen_strength: float = 0.25,
) -> TableImageVariant:
    detection = detect_table_quad(image)
    interpolation_name, _ = resolve_rectify_interpolation()
    rectify_scale = resolve_rectify_scale()
    trim_options = border_trim_options or resolve_default_border_trim_options()
    coverage_confidence = min(1.0, (detection.line_coverage_horizontal + detection.line_coverage_vertical) * 5.0)
    angle_abs = abs(detection.deskew_angle)
    deskew_allowed = (
        use_table_deskew
        and angle_abs >= max(0.0, deskew_min_angle_deg)
        and angle_abs <= max(0.0, deskew_max_angle_deg)
        and coverage_confidence >= max(0.0, min(1.0, deskew_min_confidence))
    )
    if detection.rectify_mode == "line_quad" and detection.quad is not None:
        rectified_image, forward_matrix, inverse_matrix, rectify_scale, interpolation_name, rectified_width, rectified_height = (
            warp_perspective_image(image, detection.quad)
        )
        base_variant = TableImageVariant(
            image=rectified_image,
            candidate_roi_bbox=candidate_roi_bbox,
            final_crop_bbox=full_crop_bbox(rectified_image.size[0], rectified_image.size[1]),
            roi_quad=detection.quad,
            forward_matrix=forward_matrix,
            inverse_matrix=inverse_matrix,
            rectified=True,
            rectify_mode="line_quad",
            rotation_applied=0,
            original_crop_width=image.size[0],
            original_crop_height=image.size[1],
            deskew_angle=detection.deskew_angle,
            quad_score=detection.quad_score,
            line_coverage_horizontal=detection.line_coverage_horizontal,
            line_coverage_vertical=detection.line_coverage_vertical,
            rectify_scale=rectify_scale,
            rectify_interpolation=interpolation_name,
            rectified_width=rectified_width,
            rectified_height=rectified_height,
            rectified_crop_offset=[0.0, 0.0],
            border_trim_applied=False,
            border_trim_bbox=None,
            border_trim_margin_px=trim_options.margin_px,
            border_trim_min_projection_ratio=trim_options.min_projection_ratio,
        )
        variant = build_trimmed_variant(image, candidate_roi_bbox, base_variant, trim_options)
        if use_post_sharpen and post_sharpen_strength > 0:
            return TableImageVariant(**{**variant.__dict__, "image": apply_post_sharpen(variant.image, post_sharpen_strength)})
        return variant
    if detection.rectify_mode == "deskew_only" and deskew_allowed:
        forward_matrix = rotation_matrix(-detection.deskew_angle, image.size[0], image.size[1])
        inverse_matrix = matrix_inverse(forward_matrix)
        deskewed_image = warp_affine_image(image, forward_matrix)
        width, height = deskewed_image.size
        base_variant = TableImageVariant(
            image=deskewed_image,
            candidate_roi_bbox=candidate_roi_bbox,
            final_crop_bbox=full_crop_bbox(width, height),
            roi_quad=None,
            forward_matrix=forward_matrix,
            inverse_matrix=inverse_matrix,
            rectified=False,
            rectify_mode="deskew_only",
            rotation_applied=0,
            original_crop_width=image.size[0],
            original_crop_height=image.size[1],
            deskew_angle=detection.deskew_angle,
            quad_score=detection.quad_score,
            line_coverage_horizontal=detection.line_coverage_horizontal,
            line_coverage_vertical=detection.line_coverage_vertical,
            rectify_scale=rectify_scale,
            rectify_interpolation=interpolation_name,
            rectified_width=width,
            rectified_height=height,
            rectified_crop_offset=[0.0, 0.0],
            border_trim_applied=False,
            border_trim_bbox=None,
            border_trim_margin_px=trim_options.margin_px,
            border_trim_min_projection_ratio=trim_options.min_projection_ratio,
        )
        variant = build_trimmed_variant(image, candidate_roi_bbox, base_variant, trim_options)
        if use_post_sharpen and post_sharpen_strength > 0:
            return TableImageVariant(**{**variant.__dict__, "image": apply_post_sharpen(variant.image, post_sharpen_strength)})
        return variant
    width, height = image.size
    base_variant = TableImageVariant(
        image=image,
        candidate_roi_bbox=candidate_roi_bbox,
        final_crop_bbox=full_crop_bbox(width, height),
        roi_quad=None,
        forward_matrix=identity_matrix(),
        inverse_matrix=identity_matrix(),
        rectified=False,
        rectify_mode="fallback_none",
        rotation_applied=0,
        original_crop_width=width,
        original_crop_height=height,
        deskew_angle=detection.deskew_angle,
        quad_score=detection.quad_score,
        line_coverage_horizontal=detection.line_coverage_horizontal,
        line_coverage_vertical=detection.line_coverage_vertical,
        rectify_scale=rectify_scale,
        rectify_interpolation=interpolation_name,
        rectified_width=width,
        rectified_height=height,
        rectified_crop_offset=[0.0, 0.0],
        border_trim_applied=False,
        border_trim_bbox=None,
        border_trim_margin_px=trim_options.margin_px,
        border_trim_min_projection_ratio=trim_options.min_projection_ratio,
    )
    return build_trimmed_variant(image, candidate_roi_bbox, base_variant, trim_options)


def rotate_table_variant_clockwise(variant: TableImageVariant) -> TableImageVariant:
    rotated_image = variant.image.transpose(Image.ROTATE_270)
    rotation = rotate_matrix_clockwise(variant.image.size[0], variant.image.size[1])
    inverse_rotation = [
        [0.0, 1.0, 0.0],
        [-1.0, 0.0, float(variant.image.size[1])],
        [0.0, 0.0, 1.0],
    ]
    return TableImageVariant(
        image=rotated_image,
        candidate_roi_bbox=variant.candidate_roi_bbox,
        final_crop_bbox=full_crop_bbox(rotated_image.size[0], rotated_image.size[1]),
        roi_quad=variant.roi_quad,
        forward_matrix=matrix_multiply(rotation, variant.forward_matrix),
        inverse_matrix=matrix_multiply(variant.inverse_matrix, inverse_rotation),
        rectified=variant.rectified,
        rectify_mode=variant.rectify_mode,
        rotation_applied=90,
        original_crop_width=variant.original_crop_width,
        original_crop_height=variant.original_crop_height,
        deskew_angle=variant.deskew_angle,
        quad_score=variant.quad_score,
        line_coverage_horizontal=variant.line_coverage_horizontal,
        line_coverage_vertical=variant.line_coverage_vertical,
        rectify_scale=variant.rectify_scale,
        rectify_interpolation=variant.rectify_interpolation,
        rectified_width=rotated_image.size[0],
        rectified_height=rotated_image.size[1],
        rectified_crop_offset=[0.0, 0.0],
        border_trim_applied=False,
        border_trim_bbox=None,
        border_trim_margin_px=variant.border_trim_margin_px,
        border_trim_min_projection_ratio=variant.border_trim_min_projection_ratio,
    )


def build_table_image_variants(
    image: Image.Image,
    candidate_roi_bbox: list[int],
    border_trim_options: BorderTrimOptions | None = None,
) -> list[TableImageVariant]:
    rectified = rectify_table_crop(image, candidate_roi_bbox, border_trim_options)
    variants = [rectified]
    if rectified.image.height > rectified.image.width * 1.15:
        rotated = rotate_table_variant_clockwise(rectified)
        variants.append(build_trimmed_variant(image, candidate_roi_bbox, rotated, border_trim_options or resolve_default_border_trim_options()))
    return variants
