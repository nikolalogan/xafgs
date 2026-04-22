import base64
import binascii
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from io import BytesIO
from functools import lru_cache
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium
import requests
from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter
from docling.document_converter import PdfFormatOption
from docling_core.types.doc.document import BoundingBox
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


class ConvertRequest(BaseModel):
    file: str = Field(min_length=1, description="base64 编码文件内容")
    filename: str = Field(min_length=1, description="原始文件名，需包含扩展名")


class ConvertResponse(BaseModel):
    filename: str
    durationMs: int
    markdown: str
    text: str
    document: dict[str, Any]
    imageOcrApplied: bool = False
    imageOcrCount: int = 0
    imageOcrSkippedCount: int = 0


@dataclass(frozen=True)
class ImageOCRCandidate:
    index: int
    picture_ref: str
    page_no: int
    bbox: BoundingBox
    crop_box: tuple[int, int, int, int]
    crop_size: tuple[int, int]
    image_payload: str


@dataclass(frozen=True)
class ImageOCRResult:
    candidate: ImageOCRCandidate
    text: str
    error: str = ""


@dataclass(frozen=True)
class ImageOCRSummary:
    markdown: str
    text: str
    document: dict[str, Any]
    applied_count: int
    skipped_count: int
    detected_count: int
    ocr_success_count: int


app = FastAPI(title="docling-service", version="0.1.0")


def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def get_artifacts_path() -> Path:
    raw = os.getenv("DOCLING_ARTIFACTS_PATH", "/opt/docling-models").strip()
    return Path(raw)


def get_layout_artifacts_candidates() -> list[Path]:
    artifacts_root = get_artifacts_path()
    return [
        artifacts_root / "model_artifacts" / "layout",
        artifacts_root / "layout",
        artifacts_root / "models" / "layout",
        artifacts_root / "docling-project--docling-layout-heron",
        artifacts_root,
    ]


def find_layout_artifacts_path() -> Path | None:
    for candidate in get_layout_artifacts_candidates():
        if (candidate / "model.safetensors").is_file():
            return candidate
    artifacts_root = get_artifacts_path()
    for candidate in sorted(artifacts_root.glob("*layout*")):
        if (candidate / "model.safetensors").is_file():
            return candidate
    return None


def get_ocr_service_base_url() -> str:
    raw = os.getenv("OCR_SERVICE_BASE_URL", "http://ocr-service:8090").strip()
    return raw.rstrip("/")


@lru_cache(maxsize=1)
def get_converter() -> DocumentConverter:
    layout_artifacts_path = find_layout_artifacts_path()
    pdf_options = PdfPipelineOptions()
    pdf_options.do_ocr = False
    pdf_options.do_table_structure = False
    pdf_options.force_backend_text = True
    if layout_artifacts_path is not None:
        pdf_options.artifacts_path = str(layout_artifacts_path)
        print(f"Using Docling layout artifacts from {layout_artifacts_path}")
    else:
        print(
            "Docling layout artifacts not found in candidates: "
            + ", ".join(str(path) for path in get_layout_artifacts_candidates())
        )
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_options=pdf_options,
                backend=PyPdfiumDocumentBackend,
            ),
        }
    )


def apply_image_ocr_supplement(
    file_path: str,
    document: Any,
    markdown: str,
    text: str,
    document_dict: dict[str, Any],
) -> ImageOCRSummary:
    if not env_bool("DOCLING_IMAGE_OCR_ENABLED", True):
        return ImageOCRSummary(markdown, text, document_dict, 0, 0, 0, 0)
    if not str(file_path).lower().endswith(".pdf"):
        return ImageOCRSummary(markdown, text, document_dict, 0, 0, 0, 0)

    pictures = list(getattr(document, "pictures", []) or [])
    if not pictures:
        add_image_ocr_meta(document_dict, [], 0)
        return ImageOCRSummary(markdown, text, document_dict, 0, 0, 0, 0)

    max_images = max(0, env_int("DOCLING_IMAGE_OCR_MAX_IMAGES", 8))
    if max_images <= 0:
        add_image_ocr_meta(document_dict, [], len(pictures))
        return ImageOCRSummary(markdown, text, document_dict, 0, len(pictures), len(pictures), 0)

    render_scale = max(1.0, env_float("DOCLING_IMAGE_OCR_RENDER_SCALE", 2.0))
    min_edge = max(1, env_int("DOCLING_IMAGE_OCR_MIN_EDGE_PX", 32))
    min_area = max(1, env_int("DOCLING_IMAGE_OCR_MIN_AREA_PX", 4096))

    candidates: list[ImageOCRCandidate] = []
    skipped_count = 0
    pdf = pdfium.PdfDocument(file_path)
    try:
        rendered_pages: dict[int, Any] = {}
        for index, picture in enumerate(pictures):
            if len(candidates) >= max_images:
                skipped_count += 1
                continue
            prov = first_picture_provenance(picture)
            if prov is None or getattr(prov, "bbox", None) is None:
                skipped_count += 1
                continue
            page_no = max(1, int(getattr(prov, "page_no", 1) or 1))
            page_image = rendered_pages.get(page_no)
            if page_image is None:
                page_image = render_pdf_page(pdf, page_no, render_scale)
                rendered_pages[page_no] = page_image
            crop_box = build_crop_box(document, page_no, prov.bbox, page_image.size)
            if crop_box is None:
                skipped_count += 1
                continue
            left, top, right, bottom = crop_box
            crop_width = right - left
            crop_height = bottom - top
            if crop_width < min_edge or crop_height < min_edge or crop_width * crop_height < min_area:
                skipped_count += 1
                continue
            crop = page_image.crop(crop_box)
            buffer = BytesIO()
            crop.save(buffer, format="JPEG", quality=90)
            candidates.append(
                ImageOCRCandidate(
                    index=index,
                    picture_ref=str(getattr(picture, "self_ref", "") or f"picture:{index}"),
                    page_no=page_no,
                    bbox=prov.bbox,
                    crop_box=crop_box,
                    crop_size=(crop_width, crop_height),
                    image_payload=base64.b64encode(buffer.getvalue()).decode("ascii"),
                )
            )
    finally:
        pdf.close()

    if not candidates:
        add_image_ocr_meta(document_dict, [], skipped_count)
        return ImageOCRSummary(markdown, text, document_dict, 0, skipped_count, len(pictures), 0)

    results = run_image_ocr(candidates)
    ocr_success_count = len([result for result in results if result.text])
    applied_results = [
        result
        for result in results
        if normalize_for_dedup(result.text)
    ]
    add_image_ocr_meta(document_dict, results, skipped_count)
    attach_picture_ocr(document_dict, results)
    merged_markdown, markdown_inserted = replace_image_placeholders(markdown, applied_results)
    merged_text, _ = replace_image_placeholders(text, applied_results, plain_text=True)
    applied_count = markdown_inserted
    skipped_count = max(0, len(pictures) - applied_count)
    document_dict["imageOcr"]["detectedCount"] = len(pictures)
    document_dict["imageOcr"]["ocrSuccessCount"] = ocr_success_count
    document_dict["imageOcr"]["insertedCount"] = applied_count
    document_dict["imageOcr"]["skippedCount"] = skipped_count
    return ImageOCRSummary(
        markdown=merged_markdown,
        text=merged_text,
        document=document_dict,
        applied_count=applied_count,
        skipped_count=skipped_count,
        detected_count=len(pictures),
        ocr_success_count=ocr_success_count,
    )


def first_picture_provenance(picture: Any) -> Any | None:
    prov = list(getattr(picture, "prov", []) or [])
    if not prov:
        return None
    return prov[0]


def render_pdf_page(pdf: Any, page_no: int, scale: float) -> Any:
    page = pdf[page_no - 1]
    try:
        bitmap = page.render(scale=scale)
        return bitmap.to_pil()
    finally:
        page.close()


def build_crop_box(document: Any, page_no: int, bbox: BoundingBox, image_size: tuple[int, int]) -> tuple[int, int, int, int] | None:
    page = (getattr(document, "pages", {}) or {}).get(page_no)
    page_size = getattr(page, "size", None)
    page_width = float(getattr(page_size, "width", 0) or 0)
    page_height = float(getattr(page_size, "height", 0) or 0)
    if page_width <= 0 or page_height <= 0:
        return None

    top_left = bbox.to_top_left_origin(page_height)
    scale_x = image_size[0] / page_width
    scale_y = image_size[1] / page_height
    left = int(max(0, min(image_size[0], top_left.l * scale_x)))
    top = int(max(0, min(image_size[1], top_left.t * scale_y)))
    right = int(max(0, min(image_size[0], top_left.r * scale_x)))
    bottom = int(max(0, min(image_size[1], top_left.b * scale_y)))
    if right <= left or bottom <= top:
        return None
    padding = max(2, env_int("DOCLING_IMAGE_OCR_PADDING_PX", 8))
    return (
        max(0, left - padding),
        max(0, top - padding),
        min(image_size[0], right + padding),
        min(image_size[1], bottom + padding),
    )


def run_image_ocr(candidates: list[ImageOCRCandidate]) -> list[ImageOCRResult]:
    max_workers = max(1, env_int("DOCLING_IMAGE_OCR_CONCURRENCY", 2))
    results: list[ImageOCRResult] = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [
            executor.submit(run_single_image_ocr, candidate)
            for candidate in candidates
        ]
        for future in as_completed(futures):
            results.append(future.result())
    results.sort(key=lambda item: (item.candidate.page_no, item.candidate.index))
    return results


def run_single_image_ocr(candidate: ImageOCRCandidate) -> ImageOCRResult:
    try:
        payload = {
            "file": candidate.image_payload,
            "fileType": 1,
            "visualize": False,
            "useTableRecognition": True,
            "useRegionDetection": True,
            "useFormulaRecognition": True,
        }
        response = requests.post(
            get_ocr_service_base_url() + "/layout-parsing",
            json=payload,
            timeout=max(1, env_int("DOCLING_IMAGE_OCR_TIMEOUT_SECONDS", 90)),
        )
        response.raise_for_status()
        text = extract_ocr_markdown(response.json())
        return ImageOCRResult(candidate=candidate, text=text)
    except Exception as exc:
        return ImageOCRResult(candidate=candidate, text="", error=str(exc))


def extract_ocr_markdown(payload: dict[str, Any]) -> str:
    results = (((payload.get("result") or {}).get("layoutParsingResults")) or [])
    parts: list[str] = []
    for item in results:
        markdown = (item or {}).get("markdown") or {}
        value = str(markdown.get("text") or "").strip()
        if value:
            parts.append(value)
    return "\n\n".join(parts).strip()


def normalize_for_dedup(value: str) -> str:
    return " ".join(str(value or "").split()).strip()


def replace_image_placeholders(
    value: str,
    results: list[ImageOCRResult],
    plain_text: bool = False,
) -> tuple[str, int]:
    content = str(value or "")
    if not content or not results:
        return content, 0

    placeholder = "<!-- image -->"
    if placeholder not in content:
        fallback = build_fallback_image_ocr_block(results, plain_text=plain_text)
        if not fallback:
            return content, 0
        base = content.strip()
        if not base:
            return fallback, len(results)
        return base + "\n\n" + fallback, len(results)

    replaced_count = 0
    merged = content
    for result in results:
        replacement = render_image_ocr_content(result, plain_text=plain_text)
        if not replacement:
            continue
        if placeholder not in merged:
            break
        merged = merged.replace(placeholder, replacement, 1)
        replaced_count += 1
    return merged, replaced_count


def build_fallback_image_ocr_block(results: list[ImageOCRResult], plain_text: bool = False) -> str:
    sections: list[str] = []
    for result in results:
        replacement = render_image_ocr_content(result, plain_text=plain_text)
        if replacement:
            sections.append(replacement)
    return "\n\n".join(sections).strip()


def render_image_ocr_content(result: ImageOCRResult, plain_text: bool = False) -> str:
    content = str(result.text or "").strip()
    if not content:
        return ""
    if plain_text:
        lines = [line.strip() for line in content.replace("\r\n", "\n").split("\n")]
        return "\n".join([line for line in lines if line])
    return content


def add_image_ocr_meta(document_dict: dict[str, Any], results: list[ImageOCRResult], skipped_count: int) -> None:
    document_dict["imageOcr"] = {
        "enabled": env_bool("DOCLING_IMAGE_OCR_ENABLED", True),
        "provider": "glm-ocr",
        "appliedCount": len([item for item in results if item.text]),
        "failedCount": len([item for item in results if item.error]),
        "skippedCount": skipped_count,
        "detectedCount": 0,
        "ocrSuccessCount": len([item for item in results if item.text]),
        "insertedCount": 0,
        "items": [image_ocr_result_to_dict(item) for item in results],
    }


def attach_picture_ocr(document_dict: dict[str, Any], results: list[ImageOCRResult]) -> None:
    pictures = document_dict.get("pictures")
    if not isinstance(pictures, list):
        return
    by_ref = {item.candidate.picture_ref: item for item in results}
    for picture in pictures:
        if not isinstance(picture, dict):
            continue
        picture_ref = str(picture.get("self_ref") or "")
        result = by_ref.get(picture_ref)
        if result is None:
            continue
        picture["imageOcr"] = image_ocr_result_to_dict(result)


def image_ocr_result_to_dict(result: ImageOCRResult) -> dict[str, Any]:
    payload = {
        "source": "glm_ocr",
        "pictureRef": result.candidate.picture_ref,
        "pageNo": result.candidate.page_no,
        "bbox": result.candidate.bbox.model_dump(mode="json"),
        "cropBox": result.candidate.crop_box,
        "cropSize": result.candidate.crop_size,
        "text": result.text,
    }
    if result.error:
        payload["error"] = result.error
    return payload


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/convert", response_model=ConvertResponse)
def convert(request: ConvertRequest) -> ConvertResponse:
    suffix = Path(request.filename).suffix.strip()
    if not suffix:
        raise HTTPException(status_code=400, detail="filename 必须包含扩展名")

    try:
        content = base64.b64decode(request.file, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="file 不是合法的 base64") from exc

    started_at = time.perf_counter()
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name

        result = get_converter().convert(temp_path)
        document = result.document
        markdown = document.export_to_markdown()
        text = document.export_to_markdown(strict_text=True)
        document_dict = document.export_to_dict()
        image_ocr_summary = apply_image_ocr_supplement(
            temp_path,
            document,
            markdown,
            text,
            document_dict,
        )

        return ConvertResponse(
            filename=request.filename,
            durationMs=int((time.perf_counter() - started_at) * 1000),
            markdown=image_ocr_summary.markdown,
            text=image_ocr_summary.text,
            document=image_ocr_summary.document,
            imageOcrApplied=image_ocr_summary.applied_count > 0,
            imageOcrCount=image_ocr_summary.applied_count,
            imageOcrSkippedCount=image_ocr_summary.skipped_count,
        )
    except HTTPException:
        raise
    except Exception as exc:
        message = str(exc)
        if (
            "Missing safe tensors file" in message
            or "Network is unreachable" in message
            or "trying to locate the files on the Hub" in message
            or "Cannot find an appropriate cached snapshot folder" in message
        ):
            candidates = ", ".join(str(path) for path in get_layout_artifacts_candidates())
            message = (
                "当前 Docling 离线模型缓存缺失，请先预热 "
                f"{get_artifacts_path()}；已检查候选目录: {candidates}；"
                "图片或扫描 PDF 请在示例页切换为 GLM OCR"
            )
        raise HTTPException(status_code=500, detail=f"docling 转换失败: {message}") from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
