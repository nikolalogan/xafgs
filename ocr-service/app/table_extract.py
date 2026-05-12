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


@dataclass(frozen=True)
class TableImageVariant:
    image: Image.Image
    candidate_roi_bbox: list[int]
    final_crop_bbox: list[float]
    roi_quad: list[list[float]] | None
    forward_matrix: list[list[float]]
    inverse_matrix: list[list[float]]
    rectified: bool
    rectify_mode: str
    rotation_applied: int
    original_crop_width: int
    original_crop_height: int
    deskew_angle: float
    quad_score: float
    line_coverage_horizontal: float
    line_coverage_vertical: float


@dataclass(frozen=True)
class RectifyDetection:
    rectify_mode: str
    quad: list[list[float]] | None
    deskew_angle: float
    quad_score: float
    line_coverage_horizontal: float
    line_coverage_vertical: float


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


def full_crop_bbox(width: int, height: int) -> list[float]:
    return [0.0, 0.0, float(width), float(height)]


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


def identity_matrix() -> list[list[float]]:
    return [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ]


def matrix_multiply(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    result = [[0.0, 0.0, 0.0] for _ in range(3)]
    for row in range(3):
        for col in range(3):
            result[row][col] = sum(a[row][index] * b[index][col] for index in range(3))
    return result


def matrix_inverse(matrix: list[list[float]]) -> list[list[float]]:
    cv2, np = load_cv2()
    inverted = np.linalg.inv(np.array(matrix, dtype=np.float32))
    return inverted.tolist()


def transform_polygon(points: list[list[float]], matrix: list[list[float]]) -> list[list[float]]:
    transformed: list[list[float]] = []
    for x, y in points:
        denominator = (matrix[2][0] * x) + (matrix[2][1] * y) + matrix[2][2]
        if abs(denominator) <= 1e-6:
            transformed.append([round(x, 2), round(y, 2)])
            continue
        next_x = ((matrix[0][0] * x) + (matrix[0][1] * y) + matrix[0][2]) / denominator
        next_y = ((matrix[1][0] * x) + (matrix[1][1] * y) + matrix[1][2]) / denominator
        transformed.append([round(next_x, 2), round(next_y, 2)])
    return transformed


def polygon_to_bbox(points: list[list[float]]) -> list[float]:
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)]


def polygon_area(points: list[list[float]]) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        area += (x1 * y2) - (x2 * y1)
    return abs(area) / 2.0


def sort_quad_points(points: list[list[float]]) -> list[list[float]]:
    ordered = sorted(points, key=lambda point: (point[1], point[0]))
    top = sorted(ordered[:2], key=lambda point: point[0])
    bottom = sorted(ordered[2:], key=lambda point: point[0])
    return [top[0], top[1], bottom[1], bottom[0]]


def estimate_line_coverage(mask: Any, axis: str) -> float:
    cv2, np = load_cv2()
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
    cv2, np = load_cv2()
    height, width = mask.shape[:2]
    counts = np.count_nonzero(mask > 0, axis=1 if axis == "horizontal" else 0)
    limit = width if axis == "horizontal" else height
    threshold = max(4, int(round(limit * min_ratio)))
    indexes = np.where(counts >= threshold)[0]
    if indexes.size == 0:
        return None
    return int(indexes[0]), int(indexes[-1])


def load_cv2() -> tuple[Any, Any]:
    try:
        import cv2
        import numpy as np
    except Exception as exc:
        raise TableExtractError("表格几何矫正依赖未就绪，请安装 `opencv-python` 和 `numpy`") from exc
    return cv2, np


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
    warped = cv2.warpAffine(source, affine, image.size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(warped)


def warp_perspective_image(image: Image.Image, quad: list[list[float]]) -> tuple[Image.Image, list[list[float]], list[list[float]]]:
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
    target_width = max(1, int(round(max(width_top, width_bottom))))
    target_height = max(1, int(round(max(height_left, height_right))))
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
    warped = cv2.warpPerspective(source, forward, (target_width, target_height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(warped), forward.tolist(), inverse.tolist()


def build_table_line_masks(image: Image.Image) -> tuple[Any, Any]:
    cv2, np = load_cv2()
    rgb = np.array(image)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 15)
    height, width = gray.shape[:2]
    horizontal_size = max(12, width // 18)
    vertical_size = max(12, height // 18)
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
    if detection.rectify_mode == "line_quad" and detection.quad is not None:
        rectified_image, forward_matrix, inverse_matrix = warp_perspective_image(image, detection.quad)
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
    )


def build_table_image_variants(image: Image.Image, candidate_roi_bbox: list[int]) -> list[TableImageVariant]:
    rectified = rectify_table_crop(image, candidate_roi_bbox)
    variants = [rectified]
    if rectified.image.height > rectified.image.width * 1.15:
        variants.append(rotate_table_variant_clockwise(rectified))
    return variants


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


def normalize_axis_boxes(boxes: list[DetectionBox], axis: str, crop_width: int, crop_height: int) -> list[DetectionBox]:
    if not boxes:
        return []

    primary_start = 1 if axis == "row" else 0
    primary_end = 3 if axis == "row" else 2
    secondary_start = 0 if axis == "row" else 1
    secondary_end = 2 if axis == "row" else 3
    primary_limit = float(crop_height if axis == "row" else crop_width)
    secondary_limit = float(crop_width if axis == "row" else crop_height)

    ordered = sorted(
        boxes,
        key=lambda item: (
            item.bbox[primary_start],
            item.bbox[primary_end],
            item.bbox[secondary_start],
        ),
    )
    normalized = []
    for item in ordered:
        bbox = [float(value) for value in item.bbox]
        bbox[primary_start] = max(0.0, min(primary_limit, bbox[primary_start]))
        bbox[primary_end] = max(bbox[primary_start], min(primary_limit, bbox[primary_end]))
        bbox[secondary_start] = max(0.0, min(secondary_limit, bbox[secondary_start]))
        bbox[secondary_end] = max(bbox[secondary_start], min(secondary_limit, bbox[secondary_end]))
        normalized.append(
            DetectionBox(
                label=item.label,
                score=item.score,
                bbox=[round(value, 2) for value in bbox],
            )
        )

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


def map_crop_bbox_to_page(crop_bbox: list[float], crop_offset: list[int], inverse_matrix: list[list[float]]) -> tuple[list[float], list[list[float]], list[float], list[list[float]]]:
    crop_polygon = bbox_to_polygon(crop_bbox)
    original_crop_polygon = transform_polygon(crop_polygon, inverse_matrix)
    page_polygon = [[round(point[0] + crop_offset[0], 2), round(point[1] + crop_offset[1], 2)] for point in original_crop_polygon]
    page_bbox = polygon_to_bbox(page_polygon)
    return crop_bbox, crop_polygon, page_bbox, page_polygon


def build_table_cells(
    rows: list[DetectionBox],
    columns: list[DetectionBox],
    column_headers: list[DetectionBox],
    projected_row_headers: list[DetectionBox],
    spanning_cells: list[DetectionBox],
    crop_size: tuple[int, int],
    crop_offset: list[int],
    inverse_matrix: list[list[float]],
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
        page_cell_polygon = [
            [round(point[0] + crop_offset[0], 2), round(point[1] + crop_offset[1], 2)]
            for point in transform_polygon(bbox_to_polygon(crop_bbox), inverse_matrix)
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
            candidate_roi_bbox = add_crop_padding(
                normalize_bbox(detection.bbox, page_width, page_height),
                page_width,
                page_height,
                env_float("TABLE_EXTRACT_CROP_PADDING_RATIO", 0.02),
                env_int("TABLE_EXTRACT_CROP_PADDING_MIN_PX", 8),
            )
            crop_image = page.image.crop(tuple(candidate_roi_bbox))
            table_variants = build_table_image_variants(crop_image, candidate_roi_bbox)
            best_variant, structure_items = recognize_best_table_variant(recognizer, table_variants, structure_threshold)
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
