import base64
import io
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image


TABLE_LABEL = "table"
DEFAULT_LAYOUT_MODEL = "juliozhao/DocLayout-YOLO-DocStructBench"
DEFAULT_STRUCTURE_MODEL = "microsoft/table-transformer-structure-recognition-v1.1-pub"
DEFAULT_LAYOUT_MODEL_FILE = "doclayout_yolo_docstructbench_imgsz1024.pt"
DEFAULT_STRUCTURE_MODEL_FILES = ("config.json", "preprocessor_config.json", "processor_config.json", "model.safetensors")
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
    if all((target / name).is_file() for name in DEFAULT_STRUCTURE_MODEL_FILES):
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
    _, np = load_cv2()
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
