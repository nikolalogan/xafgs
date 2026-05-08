import os
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.startup_checks import ensure_startup_prerequisites
from app.table_extract import TableExtractError, extract_tables


class TableExtractRequest(BaseModel):
    file: str
    fileType: int | None = None
    pages: list[int] | None = None
    detectorThreshold: float | None = None
    structureThreshold: float | None = None
    maxTablesPerPage: int | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_startup_prerequisites()
    yield


app = FastAPI(title="OCR Table Extract Service", version="1.0.0", lifespan=lifespan)


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
