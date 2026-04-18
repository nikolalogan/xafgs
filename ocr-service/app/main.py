from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from app.models import OCRTaskCreateRequest
from app.service import OCRTaskManager

app = FastAPI(title="ocr-service", version="0.1.0")
manager = OCRTaskManager()


@app.on_event("startup")
def on_startup():
    manager.start()


@app.on_event("shutdown")
def on_shutdown():
    manager.shutdown()


@app.get("/health")
def health():
    payload = manager.health_payload()
    status_code = 200 if payload.get("serviceReady") else 503
    return JSONResponse(content=payload, status_code=status_code)


@app.post("/api/ocr/tasks")
def create_ocr_task(request: OCRTaskCreateRequest):
    return manager.create_task(request)


@app.get("/api/ocr/tasks/{task_id}")
def get_ocr_task(task_id: str):
    try:
        return manager.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="task not found") from exc
