import base64
import binascii
import os
import tempfile
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter
from docling.document_converter import PdfFormatOption
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


app = FastAPI(title="docling-service", version="0.1.0")


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

        return ConvertResponse(
            filename=request.filename,
            durationMs=int((time.perf_counter() - started_at) * 1000),
            markdown=document.export_to_markdown(),
            text=document.export_to_markdown(strict_text=True),
            document=document.export_to_dict(),
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
