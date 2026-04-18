from __future__ import annotations

import base64
import logging
import multiprocessing as mp
import os
import queue
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional

from app.models import OCRResult, OCRTaskCreateRequest, OCRTaskView
from app.providers.local_pp_structure import LocalPPStructureProvider
from app.providers.remote_tencent import RemoteTencentOCRProvider

logger = logging.getLogger("ocr-task-manager")


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
        self.device = (os.getenv("OCR_PPSTRUCTURE_DEVICE", "cpu").strip() or "cpu").lower()
        self.gpu_required = self.device.startswith("gpu")
        self.gpu_ready = False
        self._tasks_lock = threading.RLock()
        self._pending_queue: queue.Queue[tuple[str, OCRTaskCreateRequest] | None] = queue.Queue()
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None
        self._mp_context = mp.get_context("spawn")
        self._local_worker_request_queue: Optional[mp.Queue] = None
        self._local_worker_result_queue: Optional[mp.Queue] = None
        self._local_worker_process: Optional[mp.Process] = None
        self._local_worker_lock = threading.RLock()
        self._ensure_runtime_or_raise()
        self.start()

    def start(self) -> None:
        self._ensure_local_worker_or_raise()
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
        self._stop_local_worker(timeout_sec=timeout_sec)

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

    def health_payload(self) -> dict:
        local_configured = self.local_provider.is_configured()
        remote_configured = self.remote_provider.is_configured()
        local_worker_alive = self._is_local_worker_alive()
        local_ready = local_configured and local_worker_alive and (not self.gpu_required or self.gpu_ready)
        service_ready = local_ready or remote_configured
        return {
            "status": "ok" if service_ready else "degraded",
            "device": self.device,
            "gpuRequired": self.gpu_required,
            "gpuReady": self.gpu_ready,
            "localProviderConfigured": local_configured,
            "remoteProviderConfigured": remote_configured,
            "localWorkerAlive": local_worker_alive,
            "localProviderReady": local_ready,
            "serviceReady": service_ready,
        }

    def _ensure_runtime_or_raise(self) -> None:
        if not self.gpu_required:
            self.gpu_ready = False
            logger.info("ocr_runtime_ready device=%s", self.device)
            return
        self._ensure_gpu_runtime_or_raise()
        self.gpu_ready = True
        logger.info("ocr_runtime_ready device=%s gpuReady=%s", self.device, self.gpu_ready)

    def _ensure_gpu_runtime_or_raise(self) -> None:
        try:
            import paddle  # type: ignore
        except Exception as exc:
            raise RuntimeError(f"ocr_gpu_unavailable: failed to import paddle runtime: {exc}") from exc

        if not paddle.device.is_compiled_with_cuda():
            raise RuntimeError("ocr_gpu_unavailable: paddle runtime is not compiled with CUDA support")

        try:
            device_count = int(paddle.device.cuda.device_count())
        except Exception as exc:
            raise RuntimeError(f"ocr_gpu_unavailable: failed to query CUDA devices: {exc}") from exc

        if device_count <= 0:
            raise RuntimeError("ocr_gpu_unavailable: no visible CUDA device in container")

    def _ensure_local_worker_or_raise(self) -> None:
        with self._local_worker_lock:
            if self._is_local_worker_alive():
                return
            self._start_local_worker_or_raise()

    def _start_local_worker_or_raise(self) -> None:
        self._local_worker_request_queue = self._mp_context.Queue(maxsize=8)
        self._local_worker_result_queue = self._mp_context.Queue(maxsize=8)
        self._local_worker_process = self._mp_context.Process(
            target=_local_pp_structure_worker_loop,
            args=(self._local_worker_request_queue, self._local_worker_result_queue),
            daemon=True,
        )
        self._local_worker_process.start()
        boot_timeout = _env_int("OCR_LOCAL_WORKER_BOOT_TIMEOUT_SEC", 300, minimum=10)
        if self._local_worker_result_queue is None:
            raise RuntimeError("ocr_local_worker_boot_failed: missing result queue")
        try:
            worker_tag, payload = self._local_worker_result_queue.get(timeout=boot_timeout)
        except queue.Empty as exc:
            self._stop_local_worker(timeout_sec=2.0)
            raise RuntimeError(f"ocr_local_worker_boot_failed: worker warmup timeout after {boot_timeout}s") from exc
        if worker_tag != "__worker_ready__":
            self._stop_local_worker(timeout_sec=2.0)
            raise RuntimeError(f"ocr_local_worker_boot_failed: invalid worker ready tag {worker_tag}")
        if not isinstance(payload, dict) or not payload.get("ok"):
            self._stop_local_worker(timeout_sec=2.0)
            error = ""
            if isinstance(payload, dict):
                error = str(payload.get("error") or "").strip()
            raise RuntimeError(f"ocr_local_worker_boot_failed: {error or 'warmup failed'}")
        logger.info("ocr_local_worker_ready pid=%s", self._local_worker_process.pid if self._local_worker_process else 0)

    def _stop_local_worker(self, timeout_sec: float = 3.0) -> None:
        with self._local_worker_lock:
            request_queue = self._local_worker_request_queue
            process = self._local_worker_process
            if request_queue is not None:
                try:
                    request_queue.put_nowait(None)
                except Exception:
                    pass
            if process is not None:
                process.join(timeout=timeout_sec)
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=2.0)
            self._local_worker_process = None
            self._local_worker_request_queue = None
            self._local_worker_result_queue = None

    def _restart_local_worker_or_raise(self, reason: str) -> None:
        logger.warning("ocr_local_worker_restart reason=%s", reason)
        self._stop_local_worker(timeout_sec=2.0)
        self._start_local_worker_or_raise()

    def _is_local_worker_alive(self) -> bool:
        process = self._local_worker_process
        return process is not None and process.is_alive()

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
        started_at = time.perf_counter()
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
            logger.warning("ocr_task_failed_invalid_payload taskId=%s fileId=%s versionNo=%s err=%s", state.task_id, request.fileId, request.versionNo, exc)
            return

        size_bytes = len(content)
        estimated_pages = _estimate_page_count(request.fileName, request.mimeType, content)
        logger.info(
            "ocr_task_started taskId=%s fileId=%s versionNo=%s providerMode=%s mimeType=%s sizeBytes=%s estimatedPages=%s enableTables=%s",
            state.task_id,
            request.fileId,
            request.versionNo,
            request.providerMode,
            request.mimeType,
            size_bytes,
            estimated_pages,
            request.enableTables,
        )

        providers = self._resolve_providers(request.providerMode)
        if not providers:
            with state.lock:
                state.status = "failed"
                state.progress = 100
                state.error_code = "ocr_provider_unavailable"
                state.error_message = "no OCR provider is configured; enable local PP-Structure model or configure remote Tencent OCR"
            logger.warning("ocr_task_failed_no_provider taskId=%s fileId=%s versionNo=%s", state.task_id, request.fileId, request.versionNo)
            return

        errors: list[str] = []
        allow_tables = os.getenv("OCR_PPSTRUCTURE_ENABLE_TABLES", "0").strip() in {"1", "true", "True", "yes", "on"}
        effective_enable_tables = bool(request.enableTables and allow_tables)
        for provider in providers:
            try:
                if provider.name == self.local_provider.name and _env_bool("OCR_LOCAL_PPSTRUCTURE_ISOLATE_PROCESS", True):
                    result = self._extract_local_in_subprocess(
                        task_id=state.task_id,
                        file_id=request.fileId,
                        version_no=request.versionNo,
                        content=content,
                        file_name=request.fileName,
                        mime_type=request.mimeType,
                        enable_tables=effective_enable_tables,
                        size_bytes=size_bytes,
                        estimated_pages=estimated_pages,
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
                elapsed_ms = int((time.perf_counter() - started_at) * 1000)
                logger.info(
                    "ocr_task_succeeded taskId=%s fileId=%s versionNo=%s provider=%s elapsedMs=%s pageCount=%s confidence=%.4f",
                    state.task_id,
                    request.fileId,
                    request.versionNo,
                    result.provider,
                    elapsed_ms,
                    result.pageCount,
                    result.confidence,
                )
                return
            except Exception as exc:
                errors.append(f"{provider.name}: {exc}")
                logger.warning(
                    "ocr_task_provider_failed taskId=%s fileId=%s versionNo=%s provider=%s err=%s",
                    state.task_id,
                    request.fileId,
                    request.versionNo,
                    provider.name,
                    exc,
                )
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
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.warning(
            "ocr_task_failed taskId=%s fileId=%s versionNo=%s elapsedMs=%s errorCode=%s errorMessage=%s",
            state.task_id,
            request.fileId,
            request.versionNo,
            elapsed_ms,
            state.error_code,
            state.error_message,
        )

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

    def _extract_local_in_subprocess(
        self,
        task_id: str,
        file_id: int,
        version_no: int,
        content: bytes,
        file_name: str,
        mime_type: str,
        enable_tables: bool,
        size_bytes: int,
        estimated_pages: int,
    ) -> OCRResult:
        timeout_sec = _resolve_local_timeout_sec(size_bytes=size_bytes, estimated_pages=estimated_pages)
        logger.info(
            "ocr_local_subprocess_started taskId=%s fileId=%s versionNo=%s timeoutSec=%s sizeBytes=%s estimatedPages=%s",
            task_id,
            file_id,
            version_no,
            timeout_sec,
            size_bytes,
            estimated_pages,
        )
        request_queue = self._local_worker_request_queue
        result_queue = self._local_worker_result_queue
        if request_queue is None or result_queue is None:
            raise RuntimeError("local_pp_structure_v3 worker queue is not ready")

        request_id = str(uuid.uuid4())
        try:
            request_queue.put((request_id, content, file_name, mime_type, enable_tables), timeout=5)
        except Exception as exc:
            raise RuntimeError(f"local_pp_structure_v3 enqueue failed: {exc}") from exc

        deadline = time.time() + float(timeout_sec)
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                self._restart_local_worker_or_raise("request_timeout")
                raise RuntimeError(
                    f"local_pp_structure_v3 timed out after {timeout_sec}s (sizeBytes={size_bytes}, estimatedPages={estimated_pages})"
                )

            if not self._is_local_worker_alive():
                self._restart_local_worker_or_raise("worker_exited")
                raise RuntimeError("local_pp_structure_v3 worker exited unexpectedly")

            wait_seconds = min(1.0, remaining)
            try:
                result_id, payload = result_queue.get(timeout=wait_seconds)
            except queue.Empty:
                continue

            if result_id != request_id:
                logger.warning("ocr_local_worker_result_mismatch expect=%s got=%s", request_id, result_id)
                continue

            if not isinstance(payload, dict):
                raise RuntimeError("local_pp_structure_v3 returned invalid payload")
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


def _local_pp_structure_worker_loop(
    request_queue: mp.Queue,
    result_queue: mp.Queue,
) -> None:
    provider = LocalPPStructureProvider()
    try:
        provider.warmup(enable_tables=False)
        result_queue.put(("__worker_ready__", {"ok": True}))
    except Exception as exc:
        result_queue.put(("__worker_ready__", {"ok": False, "error": str(exc)}))
        return

    while True:
        item = request_queue.get()
        if item is None:
            break
        request_id, content, file_name, mime_type, enable_tables = item
        try:
            result = provider.extract(content, file_name, mime_type, enable_tables)
            result_queue.put((request_id, {"ok": True, "result": result.model_dump()}))
        except Exception as exc:
            result_queue.put((request_id, {"ok": False, "error": str(exc)}))


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


def _resolve_local_timeout_sec(size_bytes: int, estimated_pages: int) -> int:
    if not _has_dynamic_timeout_config():
        return _env_int("OCR_LOCAL_PPSTRUCTURE_TIMEOUT_SEC", 180, minimum=30)

    base = _env_int("OCR_LOCAL_TIMEOUT_BASE_SEC", 120, minimum=1)
    per_page = _env_int("OCR_LOCAL_TIMEOUT_PER_PAGE_SEC", 18, minimum=0)
    size_step_mb = _env_int("OCR_LOCAL_TIMEOUT_SIZE_STEP_MB", 50, minimum=1)
    size_bonus = _env_int("OCR_LOCAL_TIMEOUT_SIZE_BONUS_SEC", 30, minimum=0)
    min_sec = _env_int("OCR_LOCAL_TIMEOUT_MIN_SEC", 120, minimum=1)
    max_sec = _env_int("OCR_LOCAL_TIMEOUT_MAX_SEC", 900, minimum=min_sec)

    size_mb = max(0.0, float(size_bytes) / (1024.0 * 1024.0))
    size_steps = int(size_mb // float(size_step_mb))
    timeout = base + max(1, estimated_pages) * per_page + size_steps * size_bonus
    if timeout < min_sec:
        return min_sec
    if timeout > max_sec:
        return max_sec
    return timeout


def _has_dynamic_timeout_config() -> bool:
    keys = (
        "OCR_LOCAL_TIMEOUT_BASE_SEC",
        "OCR_LOCAL_TIMEOUT_PER_PAGE_SEC",
        "OCR_LOCAL_TIMEOUT_SIZE_STEP_MB",
        "OCR_LOCAL_TIMEOUT_SIZE_BONUS_SEC",
        "OCR_LOCAL_TIMEOUT_MIN_SEC",
        "OCR_LOCAL_TIMEOUT_MAX_SEC",
    )
    return any(os.getenv(key) is not None for key in keys)


def _env_int(name: str, default: int, minimum: int | None = None) -> int:
    raw = os.getenv(name)
    if raw is None:
        value = default
    else:
        try:
            value = int(raw.strip())
        except Exception:
            value = default
    if minimum is not None and value < minimum:
        return minimum
    return value


def _estimate_page_count(file_name: str, mime_type: str, content: bytes) -> int:
    mime = (mime_type or "").strip().lower()
    name = (file_name or "").strip().lower()
    if mime == "application/pdf" or name.endswith(".pdf"):
        marker = b"/Type /Page"
        count = content.count(marker)
        if count <= 0:
            return 1
        if count >= 2:
            return max(1, count - 1)
        return count
    return 1
