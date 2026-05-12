from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from PIL import Image

from app.table_extract_shared import (
    BorderTrimOptions,
    TableImageVariant,
    full_crop_bbox,
    identity_matrix,
    load_cv2,
)

_DESKEW_SOURCE = "opencv_hough_lines"
_HOUGH_THRESHOLD = 30
_MAX_LINE_GAP = 12
_MAX_AXIS_DEVIATION_DEG = 12.0
_MIN_FOREGROUND_RATIO = 0.0005
_MAX_FOREGROUND_RATIO = 0.2
_MAX_DESKEW_ANGLE_DEG = 10.0
_KERNEL_AXIS_DRIFT_PX = 3.0
_ANGLE_FILTER_EPSILON_DEG = 0.02
_MAX_POST_SHARPEN_STRENGTH = 1.0


@dataclass(frozen=True)
class _AngleCandidate:
    angle_deg: float
    weight: float


def _pil_to_bgr(image: Image.Image) -> Any:
    cv2, np = load_cv2()
    rgb = np.array(image.convert("RGB"))
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def _bgr_to_pil(image: Any) -> Image.Image:
    cv2, _ = load_cv2()
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb)


def _apply_post_sharpen(image: Any, *, strength: float) -> Any:
    cv2, np = load_cv2()
    clamped_strength = max(0.0, min(strength, _MAX_POST_SHARPEN_STRENGTH))
    if clamped_strength <= 0.0:
        return image
    kernel = np.array(
        [[0.0, -clamped_strength, 0.0], [-clamped_strength, 1.0 + (4.0 * clamped_strength), -clamped_strength], [0.0, -clamped_strength, 0.0]],
        dtype=np.float32,
    )
    return cv2.filter2D(image, ddepth=-1, kernel=kernel, borderType=cv2.BORDER_REPLICATE)


def _line_kernel_span(axis_length: int, max_angle_deg: float) -> int:
    base_span = max(12, int(axis_length * 0.18))
    if max_angle_deg <= 0.0:
        return base_span
    safe_angle_rad = math.radians(min(max_angle_deg, _MAX_DESKEW_ANGLE_DEG))
    if safe_angle_rad <= 0.0:
        return base_span
    span_cap = max(12, int(_KERNEL_AXIS_DRIFT_PX / math.tan(safe_angle_rad)))
    return min(base_span, span_cap)


def _extract_line_masks(image: Image.Image, *, max_angle_deg: float) -> tuple[Any, Any]:
    cv2, _ = load_cv2()
    grayscale = image.convert("L")
    inverted = cv2.bitwise_not(_to_np(grayscale))
    binary = cv2.adaptiveThreshold(inverted, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, -2)
    height, width = binary.shape
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (_line_kernel_span(width, max_angle_deg), 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, _line_kernel_span(height, max_angle_deg)))
    return (
        cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel),
        cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel),
    )


def _to_np(image: Image.Image) -> Any:
    _, np = load_cv2()
    return np.array(image)


def _mask_has_usable_support(mask: Any) -> bool:
    _, np = load_cv2()
    foreground_ratio = float(np.count_nonzero(mask)) / float(mask.size)
    return _MIN_FOREGROUND_RATIO <= foreground_ratio <= _MAX_FOREGROUND_RATIO


def _detect_lines(mask: Any, *, axis: str) -> Any:
    cv2, _ = load_cv2()
    if not _mask_has_usable_support(mask):
        return None
    height, width = mask.shape
    min_line_length = max(12, int((width if axis == "horizontal" else height) * 0.35))
    return cv2.HoughLinesP(mask, rho=1, theta=3.1415926535 / 1800, threshold=_HOUGH_THRESHOLD, minLineLength=min_line_length, maxLineGap=_MAX_LINE_GAP)


def _normalize_line_angle(angle_deg: float) -> float:
    normalized = ((angle_deg + 90.0) % 180.0) - 90.0
    return 90.0 if normalized == -90.0 else normalized


def _vertical_deviation(angle_deg: float) -> float:
    normalized = _normalize_line_angle(angle_deg)
    return normalized - 90.0 if normalized >= 0.0 else normalized + 90.0


def _collect_candidates(lines: Any, *, axis: str, min_angle_deg: float, max_angle_deg: float) -> list[_AngleCandidate]:
    _, np = load_cv2()
    if lines is None:
        return []
    candidates: list[_AngleCandidate] = []
    for raw in lines:
        x1, y1, x2, y2 = raw[0]
        dx = float(x2 - x1)
        dy = float(y2 - y1)
        length = float(np.hypot(dx, dy))
        if length <= 0.0:
            continue
        line_angle = float(np.degrees(np.arctan2(dy, dx)))
        normalized_angle = _normalize_line_angle(line_angle)
        if axis == "horizontal":
            if abs(normalized_angle) > _MAX_AXIS_DEVIATION_DEG:
                continue
            applied_angle = -normalized_angle
        else:
            if abs(abs(normalized_angle) - 90.0) > _MAX_AXIS_DEVIATION_DEG:
                continue
            applied_angle = -_vertical_deviation(line_angle)
        absolute_angle = abs(applied_angle)
        if absolute_angle + _ANGLE_FILTER_EPSILON_DEG < min_angle_deg:
            continue
        if absolute_angle - _ANGLE_FILTER_EPSILON_DEG > max_angle_deg:
            continue
        candidates.append(_AngleCandidate(angle_deg=applied_angle, weight=length))
    return candidates


def _weighted_median(candidates: list[_AngleCandidate]) -> float:
    ordered = sorted(candidates, key=lambda item: item.angle_deg)
    total_weight = sum(item.weight for item in ordered)
    threshold = total_weight / 2.0
    cumulative = 0.0
    for item in ordered:
        cumulative += item.weight
        if cumulative >= threshold:
            return item.angle_deg
    return ordered[-1].angle_deg


def _refine_angle(candidates: list[_AngleCandidate], median_angle_deg: float) -> float:
    cluster = [item for item in candidates if abs(item.angle_deg - median_angle_deg) <= 1.0]
    if not cluster:
        return median_angle_deg
    total_weight = sum(item.weight for item in cluster)
    return sum(item.angle_deg * item.weight for item in cluster) / max(total_weight, 1e-6)


def _estimate_confidence(candidates: list[_AngleCandidate], *, angle_deg: float, image_size: tuple[int, int], max_angle_deg: float) -> float:
    width, height = image_size
    total_length = sum(item.weight for item in candidates)
    length_ratio = min(1.0, total_length / max(1.0, 4.0 * max(width, height)))
    deviation = sum(item.weight * abs(item.angle_deg - angle_deg) for item in candidates) / max(total_length, 1e-6)
    allowed_deviation = max(0.2, max_angle_deg * 0.35)
    dispersion_score = max(0.0, 1.0 - (deviation / allowed_deviation))
    return max(0.0, min(1.0, (0.6 * length_ratio) + (0.4 * dispersion_score)))


def _rotation_matrices(image_size: tuple[int, int], angle_deg: float) -> tuple[Any, Any]:
    cv2, _ = load_cv2()
    width, height = image_size
    center = (width / 2.0, height / 2.0)
    forward = cv2.getRotationMatrix2D(center, angle_deg, 1.0).astype("float32")
    inverse = cv2.invertAffineTransform(forward).astype("float32")
    return forward, inverse


def _estimate_deskew(image: Image.Image, *, min_angle_deg: float, max_angle_deg: float, min_confidence: float) -> tuple[float, float] | None:
    if max_angle_deg < min_angle_deg:
        return None
    horizontal_mask, vertical_mask = _extract_line_masks(image, max_angle_deg=max_angle_deg)
    candidates = _collect_candidates(_detect_lines(horizontal_mask, axis="horizontal"), axis="horizontal", min_angle_deg=min_angle_deg, max_angle_deg=max_angle_deg)
    candidates.extend(_collect_candidates(_detect_lines(vertical_mask, axis="vertical"), axis="vertical", min_angle_deg=min_angle_deg, max_angle_deg=max_angle_deg))
    if not candidates:
        return None
    angle_deg = _refine_angle(candidates, _weighted_median(candidates))
    confidence = _estimate_confidence(candidates, angle_deg=angle_deg, image_size=image.size, max_angle_deg=max_angle_deg)
    if confidence < min_confidence:
        return None
    return angle_deg, confidence


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
    del border_trim_options
    if not use_table_deskew:
        return TableImageVariant(
            image=image,
            candidate_roi_bbox=candidate_roi_bbox,
            final_crop_bbox=full_crop_bbox(image.size[0], image.size[1]),
            roi_quad=None,
            forward_matrix=identity_matrix(),
            inverse_matrix=identity_matrix(),
            rectified=False,
            rectify_mode="fallback_none",
            rotation_applied=0,
            original_crop_width=image.size[0],
            original_crop_height=image.size[1],
            deskew_angle=0.0,
            quad_score=0.0,
            line_coverage_horizontal=0.0,
            line_coverage_vertical=0.0,
            rectify_scale=1.0,
            rectify_interpolation="cubic",
            rectified_width=image.size[0],
            rectified_height=image.size[1],
            rectified_crop_offset=[0.0, 0.0],
            border_trim_applied=False,
            border_trim_bbox=None,
            border_trim_margin_px=0,
            border_trim_min_projection_ratio=0.0,
        )
    min_angle = abs(deskew_min_angle_deg)
    max_angle = abs(deskew_max_angle_deg)
    estimate = _estimate_deskew(image, min_angle_deg=min_angle, max_angle_deg=max_angle, min_confidence=deskew_min_confidence)
    if estimate is None:
        corrected = _pil_to_bgr(image)
        if use_post_sharpen:
            corrected = _apply_post_sharpen(corrected, strength=post_sharpen_strength)
        corrected_image = _bgr_to_pil(corrected)
        return TableImageVariant(
            image=corrected_image,
            candidate_roi_bbox=candidate_roi_bbox,
            final_crop_bbox=full_crop_bbox(corrected_image.size[0], corrected_image.size[1]),
            roi_quad=None,
            forward_matrix=identity_matrix(),
            inverse_matrix=identity_matrix(),
            rectified=False,
            rectify_mode="fallback_none",
            rotation_applied=0,
            original_crop_width=image.size[0],
            original_crop_height=image.size[1],
            deskew_angle=0.0,
            quad_score=0.0,
            line_coverage_horizontal=0.0,
            line_coverage_vertical=0.0,
            rectify_scale=1.0,
            rectify_interpolation="cubic",
            rectified_width=corrected_image.size[0],
            rectified_height=corrected_image.size[1],
            rectified_crop_offset=[0.0, 0.0],
            border_trim_applied=False,
            border_trim_bbox=None,
            border_trim_margin_px=0,
            border_trim_min_projection_ratio=0.0,
        )
    angle_deg, confidence = estimate
    forward_matrix, inverse_matrix = _rotation_matrices(image.size, -angle_deg)
    cv2, _ = load_cv2()
    corrected = cv2.warpAffine(_pil_to_bgr(image), forward_matrix, image.size, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
    if use_post_sharpen:
        corrected = _apply_post_sharpen(corrected, strength=post_sharpen_strength)
    corrected_image = _bgr_to_pil(corrected)
    return TableImageVariant(
        image=corrected_image,
        candidate_roi_bbox=candidate_roi_bbox,
        final_crop_bbox=full_crop_bbox(corrected_image.size[0], corrected_image.size[1]),
        roi_quad=None,
        forward_matrix=[list(map(float, row)) for row in [list(forward_matrix[0]) + [0.0], list(forward_matrix[1]) + [0.0], [0.0, 0.0, 1.0]]],
        inverse_matrix=[list(map(float, row)) for row in [list(inverse_matrix[0]) + [0.0], list(inverse_matrix[1]) + [0.0], [0.0, 0.0, 1.0]]],
        rectified=True,
        rectify_mode="deskew_only",
        rotation_applied=0,
        original_crop_width=image.size[0],
        original_crop_height=image.size[1],
        deskew_angle=float(angle_deg),
        quad_score=round(float(confidence), 4),
        line_coverage_horizontal=0.0,
        line_coverage_vertical=0.0,
        rectify_scale=1.0,
        rectify_interpolation="cubic",
        rectified_width=corrected_image.size[0],
        rectified_height=corrected_image.size[1],
        rectified_crop_offset=[0.0, 0.0],
        border_trim_applied=False,
        border_trim_bbox=None,
        border_trim_margin_px=0,
        border_trim_min_projection_ratio=0.0,
    )


def build_table_image_variants(
    image: Image.Image,
    candidate_roi_bbox: list[int],
    border_trim_options: BorderTrimOptions | None = None,
) -> list[TableImageVariant]:
    return [rectify_table_crop(image, candidate_roi_bbox, border_trim_options=border_trim_options)]


def rotate_table_variant_clockwise(variant: TableImageVariant) -> TableImageVariant:
    return variant


def detect_table_quad(image: Image.Image) -> Any:
    del image
    return None
