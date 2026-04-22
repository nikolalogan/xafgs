import base64
import binascii
import logging
import os
import shutil
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
try:
    from docling.datamodel.pipeline_options import KserveV2OcrOptions
except Exception:
    KserveV2OcrOptions = None
from docling.document_converter import DocumentConverter
from docling.document_converter import PdfFormatOption
from docling_core.types.doc.document import BoundingBox
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from app.markdown_normalizer import markdown_to_plain_text, normalize_docling_like_markdown

logger = logging.getLogger("docling_service")


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
    image_source: str
    image_size: tuple[int, int]
    payload_bytes: int
    image_payload: str


@dataclass(frozen=True)
class ImageOCRResult:
    candidate: ImageOCRCandidate
    text: str
    raw_text: str = ""
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


def get_serve_artifacts_path() -> Path:
    raw = os.getenv("DOCLING_SERVE_ARTIFACTS_PATH", "").strip()
    if raw:
        return Path(raw)
    return get_artifacts_path() / "serve_artifacts"


def get_layout_artifacts_candidates() -> list[Path]:
    artifacts_root = get_artifacts_path()
    return [
        artifacts_root / "model_artifacts" / "layout",
        artifacts_root / "layout",
        artifacts_root / "models" / "layout",
        artifacts_root / "docling-project--docling-layout-heron",
        artifacts_root,
    ]


def get_table_artifacts_candidates() -> list[Path]:
    artifacts_root = get_artifacts_path()
    return [
        artifacts_root / "docling-project--docling-models" / "model_artifacts" / "tableformer",
        artifacts_root / "model_artifacts" / "tableformer",
        artifacts_root / "tableformer",
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


def has_table_artifacts() -> bool:
    return find_table_artifacts_path() is not None


def find_table_artifacts_path() -> Path | None:
    for candidate in get_table_artifacts_candidates():
        if (
            (candidate / "accurate" / "tableformer_accurate.safetensors").is_file()
            or (candidate / "fast" / "tableformer_fast.safetensors").is_file()
        ):
            return candidate
    return None


def ensure_serve_artifacts() -> None:
    missing_serve_paths = get_missing_serve_artifact_paths()
    if not missing_serve_paths:
        return

    layout_artifacts = find_layout_artifacts_path()
    table_artifacts = find_table_artifacts_path()
    if layout_artifacts is None or table_artifacts is None:
        return

    serve_root = get_serve_artifacts_path()
    accurate_root = serve_root / "accurate"
    fast_root = serve_root / "fast"
    accurate_root.mkdir(parents=True, exist_ok=True)
    fast_root.mkdir(parents=True, exist_ok=True)

    copies = [
        (layout_artifacts / "model.safetensors", serve_root / "model.safetensors"),
        (layout_artifacts / "config.json", serve_root / "config.json"),
        (layout_artifacts / "preprocessor_config.json", serve_root / "preprocessor_config.json"),
        (table_artifacts / "accurate" / "tm_config.json", accurate_root / "tm_config.json"),
        (table_artifacts / "accurate" / "tableformer_accurate.safetensors", accurate_root / "tableformer_accurate.safetensors"),
        (table_artifacts / "fast" / "tm_config.json", fast_root / "tm_config.json"),
        (table_artifacts / "fast" / "tableformer_fast.safetensors", fast_root / "tableformer_fast.safetensors"),
    ]
    for source, destination in copies:
        if source.is_file() and not destination.is_file():
            shutil.copy2(source, destination)


def get_table_artifacts_summary() -> str:
    details: list[str] = []
    for candidate in get_table_artifacts_candidates():
        accurate = candidate / "accurate" / "tableformer_accurate.safetensors"
        fast = candidate / "fast" / "tableformer_fast.safetensors"
        if accurate.is_file() or fast.is_file():
            modes: list[str] = []
            if accurate.is_file():
                modes.append(f"accurate={accurate}")
            if fast.is_file():
                modes.append(f"fast={fast}")
            details.append(f"{candidate} ({', '.join(modes)})")
    return "; ".join(details)


def get_required_serve_artifact_paths() -> list[Path]:
    serve_root = get_serve_artifacts_path()
    return [
        serve_root / "model.safetensors",
        serve_root / "config.json",
        serve_root / "preprocessor_config.json",
        serve_root / "accurate" / "tm_config.json",
        serve_root / "accurate" / "tableformer_accurate.safetensors",
        serve_root / "fast" / "tm_config.json",
        serve_root / "fast" / "tableformer_fast.safetensors",
    ]


def get_missing_serve_artifact_paths() -> list[Path]:
    return [path for path in get_required_serve_artifact_paths() if not path.is_file()]


def get_ocr_service_base_url() -> str:
    raw = os.getenv("OCR_SERVICE_BASE_URL", "http://ocr-service:8090").strip()
    return raw.rstrip("/")


def get_docling_ocr_provider() -> str:
    raw = os.getenv("DOCLING_OCR_PROVIDER", "none").strip().lower()
    if raw in {"none", "glm_kserve"}:
        return raw
    return "none"


def build_glm_kserve_ocr_options() -> Any:
    if KserveV2OcrOptions is None:
        raise RuntimeError("当前 Docling 版本不支持 KserveV2OcrOptions，无法启用 glm_kserve OCR")

    endpoint = os.getenv("DOCLING_GLM_KSERVE_URL", get_ocr_service_base_url()).strip().rstrip("/")
    model_name = os.getenv("DOCLING_GLM_KSERVE_MODEL", "glm-ocr").strip() or "glm-ocr"
    try:
        return KserveV2OcrOptions(
            url=endpoint,
            model_name=model_name,
            transport=os.getenv("DOCLING_GLM_KSERVE_TRANSPORT", "http").strip() or "http",
        )
    except TypeError:
        options = KserveV2OcrOptions()
        for key, value in {
            "url": endpoint,
            "endpoint": endpoint,
            "model_name": model_name,
            "model": model_name,
            "transport": os.getenv("DOCLING_GLM_KSERVE_TRANSPORT", "http").strip() or "http",
        }.items():
            if hasattr(options, key):
                setattr(options, key, value)
        return options


@lru_cache(maxsize=1)
def get_converter() -> DocumentConverter:
    table_structure_enabled = env_bool("DOCLING_TABLE_STRUCTURE_ENABLED", True)
    ocr_provider = get_docling_ocr_provider()
    serve_artifacts_path = get_serve_artifacts_path()
    pdf_options = PdfPipelineOptions()
    pdf_options.do_ocr = ocr_provider == "glm_kserve"
    if ocr_provider == "glm_kserve":
        pdf_options.enable_remote_services = True
        pdf_options.ocr_options = build_glm_kserve_ocr_options()
    pdf_options.do_table_structure = table_structure_enabled
    pdf_options.force_backend_text = True
    ensure_serve_artifacts()
    missing_serve_paths = get_missing_serve_artifact_paths()
    if missing_serve_paths:
        raise RuntimeError(
            "Docling serve artifacts not found. Missing: "
            + ", ".join(str(path) for path in missing_serve_paths)
        )
    pdf_options.artifacts_path = str(serve_artifacts_path)
    print(f"Using Docling serve artifacts from {serve_artifacts_path}")
    if ocr_provider == "glm_kserve":
        print(f"Using Docling remote OCR provider glm_kserve via {get_ocr_service_base_url()}")
    if table_structure_enabled and has_table_artifacts():
        print("Docling cached table artifacts source: " + get_table_artifacts_summary())
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
            picture_ref = str(getattr(picture, "self_ref", "") or f"picture:{index}")
            if len(candidates) >= max_images:
                logger.info("image_ocr_skip picture_ref=%s reason=max_images_reached", picture_ref)
                skipped_count += 1
                continue
            prov = first_picture_provenance(picture)
            if prov is None or getattr(prov, "bbox", None) is None:
                logger.info("image_ocr_skip picture_ref=%s reason=missing_bbox", picture_ref)
                skipped_count += 1
                continue
            page_no = max(1, int(getattr(prov, "page_no", 1) or 1))
            embedded_image = extract_embedded_picture_image(picture)
            if embedded_image is not None:
                payload_bytes = len(embedded_image["bytes"])
                image_size = embedded_image["image_size"]
                if image_size[0] < min_edge or image_size[1] < min_edge or image_size[0] * image_size[1] < min_area:
                    logger.info(
                        "image_ocr_skip picture_ref=%s page_no=%s reason=embedded_too_small image_size=%s payload_bytes=%s",
                        picture_ref,
                        page_no,
                        image_size,
                        payload_bytes,
                    )
                    skipped_count += 1
                    continue
                candidates.append(
                    ImageOCRCandidate(
                        index=index,
                        picture_ref=picture_ref,
                        page_no=page_no,
                        bbox=prov.bbox,
                        crop_box=(0, 0, image_size[0], image_size[1]),
                        crop_size=image_size,
                        image_source=str(embedded_image["source"]),
                        image_size=image_size,
                        payload_bytes=payload_bytes,
                        image_payload=base64.b64encode(embedded_image["bytes"]).decode("ascii"),
                    )
                )
                logger.info(
                    "image_ocr_candidate picture_ref=%s page_no=%s image_source=%s image_size=%s payload_bytes=%s crop_box=%s",
                    picture_ref,
                    page_no,
                    embedded_image["source"],
                    image_size,
                    payload_bytes,
                    (0, 0, image_size[0], image_size[1]),
                )
                continue
            page_image = rendered_pages.get(page_no)
            if page_image is None:
                page_image = render_pdf_page(pdf, page_no, render_scale)
                rendered_pages[page_no] = page_image
            crop_box = build_crop_box(document, page_no, prov.bbox, page_image.size)
            if crop_box is None:
                logger.info("image_ocr_skip picture_ref=%s page_no=%s reason=invalid_crop_box", picture_ref, page_no)
                skipped_count += 1
                continue
            left, top, right, bottom = crop_box
            crop_width = right - left
            crop_height = bottom - top
            if crop_width < min_edge or crop_height < min_edge or crop_width * crop_height < min_area:
                logger.info(
                    "image_ocr_skip picture_ref=%s page_no=%s reason=crop_too_small crop_size=%s crop_box=%s",
                    picture_ref,
                    page_no,
                    (crop_width, crop_height),
                    crop_box,
                )
                skipped_count += 1
                continue
            crop = page_image.crop(crop_box)
            buffer = BytesIO()
            crop.save(buffer, format="JPEG", quality=90)
            crop_bytes = buffer.getvalue()
            candidates.append(
                ImageOCRCandidate(
                    index=index,
                    picture_ref=picture_ref,
                    page_no=page_no,
                    bbox=prov.bbox,
                    crop_box=crop_box,
                    crop_size=(crop_width, crop_height),
                    image_source="page_crop",
                    image_size=(crop_width, crop_height),
                    payload_bytes=len(crop_bytes),
                    image_payload=base64.b64encode(crop_bytes).decode("ascii"),
                )
            )
            logger.info(
                "image_ocr_candidate picture_ref=%s page_no=%s image_source=page_crop image_size=%s payload_bytes=%s crop_box=%s",
                picture_ref,
                page_no,
                (crop_width, crop_height),
                len(crop_bytes),
                crop_box,
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


def extract_embedded_picture_image(picture: Any) -> dict[str, Any] | None:
    for attribute, source in (
        ("pil_image", "embedded_pil_image"),
        ("image", "embedded_image"),
        ("_image", "embedded__image"),
    ):
        image_obj = getattr(picture, attribute, None)
        extracted = image_object_to_bytes(image_obj, source)
        if extracted is not None:
            return extracted
    for method_name, source in (
        ("get_image", "embedded_get_image"),
        ("get_image_data", "embedded_get_image_data"),
        ("load_image", "embedded_load_image"),
    ):
        method = getattr(picture, method_name, None)
        if callable(method):
            try:
                extracted = image_object_to_bytes(method(), source)
            except Exception:
                extracted = None
            if extracted is not None:
                return extracted
    return None


def image_object_to_bytes(image_obj: Any, source: str) -> dict[str, Any] | None:
    if image_obj is None:
        return None
    if isinstance(image_obj, (bytes, bytearray)):
        width = 0
        height = 0
        try:
            with Image.open(BytesIO(bytes(image_obj))) as opened:
                width, height = opened.size
        except Exception:
            pass
        return {
            "bytes": bytes(image_obj),
            "image_size": (width, height),
            "source": source,
        }
    if hasattr(image_obj, "size") and hasattr(image_obj, "save"):
        buffer = BytesIO()
        image_obj.save(buffer, format="PNG")
        width, height = image_obj.size
        return {
            "bytes": buffer.getvalue(),
            "image_size": (int(width), int(height)),
            "source": source,
        }
    nested = getattr(image_obj, "pil_image", None)
    if nested is not None:
        return image_object_to_bytes(nested, source)
    nested_bytes = getattr(image_obj, "data", None)
    if isinstance(nested_bytes, (bytes, bytearray)):
        width = int(getattr(image_obj, "width", 0) or 0)
        height = int(getattr(image_obj, "height", 0) or 0)
        return {
            "bytes": bytes(nested_bytes),
            "image_size": (width, height),
            "source": source,
        }
    return None


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
    payload = {
        "file": candidate.image_payload,
        "fileType": 1,
        "useTableRecognition": True,
    }
    try:
        logger.info(
            "image_ocr_request picture_ref=%s page_no=%s image_source=%s image_size=%s payload_bytes=%s crop_box=%s",
            candidate.picture_ref,
            candidate.page_no,
            candidate.image_source,
            candidate.image_size,
            candidate.payload_bytes,
            candidate.crop_box,
        )
        response = requests.post(
            get_ocr_service_base_url() + "/markdown-ocr",
            json=payload,
            timeout=max(1, env_int("DOCLING_IMAGE_OCR_TIMEOUT_SECONDS", 450)),
        )
        response.raise_for_status()
        raw_text = extract_markdown_ocr_text(response.json())
    except Exception as exc:
        raise RuntimeError(
            "图片 GLM Markdown OCR 失败: "
            f"pageNo={candidate.page_no}, pictureRef={candidate.picture_ref}, error={build_ocr_error_summary(exc)}"
        ) from exc
    cleaned_text = normalize_docling_like_markdown(raw_text)
    logger.info(
        "image_ocr_response picture_ref=%s page_no=%s image_source=%s raw_preview=%s cleaned_preview=%s",
        candidate.picture_ref,
        candidate.page_no,
        candidate.image_source,
        raw_text[:200].replace("\n", "\\n"),
        cleaned_text[:200].replace("\n", "\\n"),
    )
    return ImageOCRResult(
        candidate=candidate,
        text=cleaned_text,
        raw_text=raw_text,
    )


def build_ocr_error_summary(exc: Exception) -> str:
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        body = exc.response.text.strip()
        if len(body) > 500:
            body = body[:500] + "..."
        return f"status={exc.response.status_code} body={body}"
    return str(exc)


def extract_ocr_markdown(payload: dict[str, Any]) -> str:
    results = (((payload.get("result") or {}).get("layoutParsingResults")) or [])
    parts: list[str] = []
    for item in results:
        markdown = (item or {}).get("markdown") or {}
        value = str(markdown.get("text") or "").strip()
        if value:
            parts.append(value)
    return "\n\n".join(parts).strip()


def extract_markdown_ocr_text(payload: dict[str, Any]) -> str:
    value = str((payload or {}).get("markdown") or "").strip()
    if value:
        return value
    return extract_ocr_markdown(payload)


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
        return markdown_to_plain_text(content)
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
        "imageSource": result.candidate.image_source,
        "imageSize": result.candidate.image_size,
        "payloadBytes": result.candidate.payload_bytes,
        "text": result.text,
        "markdownEndpoint": "/markdown-ocr",
    }
    if result.raw_text:
        payload["rawText"] = result.raw_text
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
            or "Docling table artifacts not found" in message
            or "Docling serve artifacts not found" in message
        ):
            candidates = ", ".join(str(path) for path in get_layout_artifacts_candidates())
            table_candidates = ", ".join(str(path) for path in get_table_artifacts_candidates())
            missing_serve_paths = get_missing_serve_artifact_paths()
            serve_candidates = ", ".join(str(path) for path in missing_serve_paths)
            if "Docling serve artifacts not found" in message:
                message = (
                    "当前 Docling 运行时 artifacts 缺失，请先预热 "
                    f"{get_artifacts_path()}；运行目录: {get_serve_artifacts_path()}；"
                    f"缺失文件: {serve_candidates}"
                )
            elif "Docling table artifacts not found" in message:
                message = (
                    "当前 Docling 表格结构模型缓存缺失，请先预热 "
                    f"{get_artifacts_path()}；已检查 table 候选目录: {table_candidates}；"
                    "图片或扫描 PDF 请在示例页切换为 GLM OCR"
                )
            else:
                message = (
                    "当前 Docling 离线模型缓存缺失，请先预热 "
                    f"{get_artifacts_path()}；已检查 layout 候选目录: {candidates}；"
                    f"table 候选目录: {table_candidates}；"
                    "图片或扫描 PDF 请在示例页切换为 GLM OCR"
                )
        raise HTTPException(status_code=500, detail=f"docling 转换失败: {message}") from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
