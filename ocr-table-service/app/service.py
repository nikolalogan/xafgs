import os
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.table_extract import TableExtractError, extract_tables


class TableExtractRequest(BaseModel):
    file: str
    fileType: int | None = None
    pages: list[int] | None = None
    detection_threshold: float | None = None
    structure_threshold: float | None = None
    table_crop_padding: float | None = None
    span_overlap_threshold: float | None = None
    use_line_refinement: bool | None = None
    row_merge_gap_ratio: float | None = None
    line_detection_sensitivity: float | None = None
    min_line_support_ratio: float | None = None
    use_table_deskew: bool | None = None
    deskew_min_angle_deg: float | None = None
    deskew_max_angle_deg: float | None = None
    deskew_min_confidence: float | None = None
    use_post_sharpen: bool | None = None
    post_sharpen_strength: float | None = None
    suppress_red_stamps: bool | None = None
    enhance_contrast: bool | None = None
    reduce_noise: bool | None = None


app = FastAPI(title="OCR Table Extract Service", version="1.0.0")


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {
        "ok": True,
        "provider": "table-extract-v1",
        "layoutModel": str(os.environ.get("TABLE_EXTRACT_LAYOUT_MODEL", "")).strip(),
        "structureModel": str(os.environ.get("TABLE_EXTRACT_STRUCTURE_MODEL", "")).strip(),
        "ts": int(time.time()),
    }


@app.post("/table-extract")
async def table_extract(payload: TableExtractRequest) -> dict[str, Any]:
    started_at = time.perf_counter()
    try:
        result = extract_tables(payload.model_dump())
    except TableExtractError as exc:
        status_code = 503 if "依赖未就绪" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"table extract failed: {exc}") from exc
    result["durationMs"] = int((time.perf_counter() - started_at) * 1000)
    return result
