from __future__ import annotations

import base64
import threading
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional

from app.models import OCRResult, OCRTaskCreateRequest, OCRTaskView
from app.providers.local_pp_structure import LocalPPStructureProvider
from app.providers.remote_tencent import RemoteTencentOCRProvider


@dataclass
class OCRTaskState:
    task_id: str
    status: str = "pending"
    provider: str = ""
    progress: int = 0
    page_count: int = 0
    confidence: float = 0.0
    error_code: str = ""
    error_message: str = ""
    result: Optional[OCRResult] = None
    lock: threading.Lock = field(default_factory=threading.Lock)


class OCRTaskManager:
    def __init__(self) -> None:
        self.tasks: Dict[str, OCRTaskState] = {}
        self.local_provider = LocalPPStructureProvider()
        self.remote_provider = RemoteTencentOCRProvider()

    def create_task(self, request: OCRTaskCreateRequest) -> OCRTaskView:
        task_id = str(uuid.uuid4())
        state = OCRTaskState(task_id=task_id, status="pending", progress=0)
        self.tasks[task_id] = state
        threading.Thread(target=self._run_task, args=(state, request), daemon=True).start()
        return self._to_view(state)

    def get_task(self, task_id: str) -> OCRTaskView:
        state = self.tasks[task_id]
        return self._to_view(state)

    def _run_task(self, state: OCRTaskState, request: OCRTaskCreateRequest) -> None:
        with state.lock:
            state.status = "running"
            state.progress = 10

        content = base64.b64decode(request.contentBase64.encode("utf-8"))
        providers = self._resolve_providers(request.providerMode)

        errors: list[str] = []
        for provider in providers:
            try:
                result = provider.extract(content, request.fileName, request.mimeType, request.enableTables)
                with state.lock:
                    state.status = "succeeded"
                    state.provider = result.provider
                    state.progress = 100
                    state.page_count = result.pageCount
                    state.confidence = result.confidence
                    state.result = result
                return
            except Exception as exc:
                errors.append(f"{provider.name}: {exc}")

        with state.lock:
            state.status = "failed"
            state.progress = 100
            state.error_code = "ocr_failed"
            state.error_message = "; ".join(errors) or "all OCR providers failed"

    def _resolve_providers(self, mode: str):
        mode = (mode or "auto").strip().lower()
        if mode == "local_only":
            return [self.local_provider]
        if mode == "remote_only":
            return [self.remote_provider]
        return [self.local_provider, self.remote_provider]

    def _to_view(self, state: OCRTaskState) -> OCRTaskView:
        return OCRTaskView(
            taskId=state.task_id,
            status=state.status,
            provider=state.provider,
            progress=state.progress,
            pageCount=state.page_count,
            confidence=state.confidence,
            errorCode=state.error_code,
            errorMessage=state.error_message,
            result=state.result,
        )
