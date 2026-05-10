from typing import Any

from PIL import Image

from app.table_extract_shared import (
    RectifyDetection,
    TableImageVariant,
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


def rectify_table_crop(image: Image.Image, candidate_roi_bbox: list[int]) -> TableImageVariant:
    detection = detect_table_quad(image)
    interpolation_name, _ = resolve_rectify_interpolation()
    rectify_scale = resolve_rectify_scale()
    if detection.rectify_mode == "line_quad" and detection.quad is not None:
        rectified_image, forward_matrix, inverse_matrix, rectify_scale, interpolation_name, rectified_width, rectified_height = (
            warp_perspective_image(image, detection.quad)
        )
        return TableImageVariant(
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
        )
    if detection.rectify_mode == "deskew_only" and abs(detection.deskew_angle) >= 0.2:
        forward_matrix = rotation_matrix(-detection.deskew_angle, image.size[0], image.size[1])
        inverse_matrix = matrix_inverse(forward_matrix)
        deskewed_image = warp_affine_image(image, forward_matrix)
        width, height = deskewed_image.size
        return TableImageVariant(
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
        )
    width, height = image.size
    return TableImageVariant(
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
    )


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
    )


def build_table_image_variants(image: Image.Image, candidate_roi_bbox: list[int]) -> list[TableImageVariant]:
    rectified = rectify_table_crop(image, candidate_roi_bbox)
    variants = [rectified]
    if rectified.image.height > rectified.image.width * 1.15:
        variants.append(rotate_table_variant_clockwise(rectified))
    return variants
