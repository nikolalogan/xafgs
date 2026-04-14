from __future__ import annotations

from fastapi import FastAPI, HTTPException

from app.models import OCRTaskCreateRequest
from app.service import OCRTaskManager

app = FastAPI(title="ocr-service", version="0.1.0")
manager = OCRTaskManager()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/ocr/tasks")
def create_ocr_task(request: OCRTaskCreateRequest):
    return manager.create_task(request)


@app.get("/api/ocr/tasks/{task_id}")
def get_ocr_task(task_id: str):
    try:
        return manager.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="task not found") from exc
