from __future__ import annotations

import base64
import multiprocessing as mp
import os
import queue
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
        self._tasks_lock = threading.RLock()
        self._pending_queue: queue.Queue[tuple[str, OCRTaskCreateRequest] | None] = queue.Queue()
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None
        self.start()

    def start(self) -> None:
        with self._tasks_lock:
            if self._worker_thread is not None and self._worker_thread.is_alive():
                return
            self._stop_event.clear()
            self._worker_thread = threading.Thread(target=self._worker_loop, name="ocr-task-worker", daemon=True)
            self._worker_thread.start()

    def shutdown(self, timeout_sec: float = 5.0) -> None:
        self._stop_event.set()
        self._pending_queue.put(None)
        worker = self._worker_thread
        if worker is not None:
            worker.join(timeout=timeout_sec)

    def create_task(self, request: OCRTaskCreateRequest) -> OCRTaskView:
        task_id = str(uuid.uuid4())
        state = OCRTaskState(task_id=task_id, status="pending", progress=0)
        with self._tasks_lock:
            self.tasks[task_id] = state
        self._pending_queue.put((task_id, request))
        return self._to_view(state)

    def get_task(self, task_id: str) -> OCRTaskView:
        with self._tasks_lock:
            state = self.tasks[task_id]
        return self._to_view(state)

    def _worker_loop(self) -> None:
        while not self._stop_event.is_set():
            item = self._pending_queue.get()
            if item is None:
                self._pending_queue.task_done()
                break
            task_id, request = item
            with self._tasks_lock:
                state = self.tasks.get(task_id)
            if state is None:
                self._pending_queue.task_done()
                continue
            self._run_task(state, request)
            self._pending_queue.task_done()

    def _run_task(self, state: OCRTaskState, request: OCRTaskCreateRequest) -> None:
        with state.lock:
            state.status = "running"
            state.progress = 10

        try:
            content = base64.b64decode(request.contentBase64.encode("utf-8"))
        except Exception as exc:
            with state.lock:
                state.status = "failed"
                state.progress = 100
                state.error_code = "ocr_invalid_payload"
                state.error_message = f"invalid base64 content: {exc}"
            return

        providers = self._resolve_providers(request.providerMode)
        if not providers:
            with state.lock:
                state.status = "failed"
                state.progress = 100
                state.error_code = "ocr_provider_unavailable"
                state.error_message = "no OCR provider is configured; enable local PP-Structure model or configure remote Tencent OCR"
            return

        errors: list[str] = []
        allow_tables = os.getenv("OCR_PPSTRUCTURE_ENABLE_TABLES", "0").strip() in {"1", "true", "True", "yes", "on"}
        effective_enable_tables = bool(request.enableTables and allow_tables)
        for provider in providers:
            try:
                if provider.name == self.local_provider.name and _env_bool("OCR_LOCAL_PPSTRUCTURE_ISOLATE_PROCESS", True):
                    result = self._extract_local_in_subprocess(
                        content=content,
                        file_name=request.fileName,
                        mime_type=request.mimeType,
                        enable_tables=effective_enable_tables,
                    )
                else:
                    result = provider.extract(content, request.fileName, request.mimeType, effective_enable_tables)
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
                classified_error_code, classified_error_message = _classify_provider_error(provider.name, exc)
                if classified_error_code:
                    with state.lock:
                        state.error_code = classified_error_code
                        state.error_message = classified_error_message

        with state.lock:
            state.status = "failed"
            state.progress = 100
            if not state.error_code:
                state.error_code = "ocr_failed"
            if not state.error_message:
                state.error_message = "; ".join(errors) or "all OCR providers failed"

    def _resolve_providers(self, mode: str):
        mode = (mode or "auto").strip().lower()
        if mode == "local_only":
            return [self.local_provider]
        if mode == "remote_only":
            return [self.remote_provider]
        providers = []
        if self.local_provider.is_configured():
            providers.append(self.local_provider)
        if self.remote_provider.is_configured():
            providers.append(self.remote_provider)
        return providers

    def _extract_local_in_subprocess(self, content: bytes, file_name: str, mime_type: str, enable_tables: bool) -> OCRResult:
        timeout_sec = int(os.getenv("OCR_LOCAL_PPSTRUCTURE_TIMEOUT_SEC", "180"))
        context = mp.get_context("spawn")
        result_queue: mp.Queue = context.Queue(maxsize=1)
        process = context.Process(
            target=_local_pp_structure_worker,
            args=(content, file_name, mime_type, enable_tables, result_queue),
            daemon=True,
        )
        process.start()
        process.join(timeout=timeout_sec)

        if process.is_alive():
            process.terminate()
            process.join(timeout=3)
            raise RuntimeError(f"local_pp_structure_v3 timed out after {timeout_sec}s")

        payload: dict | None = None
        try:
            payload = result_queue.get_nowait()
        except queue.Empty:
            payload = None

        if process.exitcode not in {0, None} and payload is None:
            if process.exitcode == -11:
                raise RuntimeError("local_pp_structure_v3 subprocess crashed by SIGSEGV (paddle cpu runtime)")
            raise RuntimeError(f"local_pp_structure_v3 subprocess crashed (exitcode={process.exitcode})")
        if payload is None:
            raise RuntimeError("local_pp_structure_v3 returned empty payload")
        if not payload.get("ok"):
            raise RuntimeError(str(payload.get("error") or "local_pp_structure_v3 failed"))
        return OCRResult(**payload["result"])

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


def _local_pp_structure_worker(
    content: bytes,
    file_name: str,
    mime_type: str,
    enable_tables: bool,
    result_queue: mp.Queue,
) -> None:
    try:
        provider = LocalPPStructureProvider()
        result = provider.extract(content, file_name, mime_type, enable_tables)
        result_queue.put({"ok": True, "result": result.model_dump()})
    except Exception as exc:
        result_queue.put({"ok": False, "error": str(exc)})


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip() in {"1", "true", "True", "yes", "on"}


def _classify_provider_error(provider_name: str, exc: Exception) -> tuple[str, str]:
    message = str(exc).strip()
    lowered = message.lower()
    if provider_name == "local_pp_structure_v3":
        if "sigsegv" in lowered or "segmentation fault" in lowered:
            return ("ocr_local_runtime_crash", "local pp-structure runtime crashed (SIGSEGV); check cpu runtime flags and model/engine compatibility")
        if "timed out" in lowered:
            return ("ocr_local_timeout", message)
    return ("", "")
