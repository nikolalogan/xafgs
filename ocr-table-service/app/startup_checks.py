from pathlib import Path

from huggingface_hub import snapshot_download
from huggingface_hub.errors import LocalEntryNotFoundError

from app.structure_cache import (
    ensure_default_structure_support_files,
    find_missing_default_structure_files,
    normalize_default_structure_config,
    normalize_default_structure_processor_configs,
)
from app.table_extract_shared import (
    DEFAULT_LAYOUT_MODEL,
    DEFAULT_STRUCTURE_MODEL,
    DEFAULT_TIMM_BACKBONE_MODEL,
    TableExtractError,
    resolve_hf_cache_dir,
    resolve_layout_cache_dir,
    resolve_layout_model_name,
    resolve_structure_cache_dir,
    resolve_structure_model_name,
)


def build_layout_model_prewarm_error() -> str:
    cache_dir = resolve_layout_cache_dir()
    warm_command = "make ocr-table-detection-model-cache-warm"
    return (
        "TATR detection 模型未预热完整，ocr-table-service 无法启动: "
        f"model={resolve_layout_model_name()}, cache_dir={cache_dir}. "
        f"请先执行 `{warm_command}` 或 `make ocr-table-cache-warm`，"
        "目标宿主机目录为 `ocr-table-service/model_cache/table_extract/layout/`。"
    )


def ensure_startup_prerequisites() -> None:
    ensure_layout_startup_prerequisites()
    ensure_structure_startup_prerequisites()
    ensure_timm_backbone_startup_prerequisites()


def ensure_layout_startup_prerequisites() -> None:
    model_name = resolve_layout_model_name()
    if model_name != DEFAULT_LAYOUT_MODEL:
        return
    cache_dir = Path(resolve_layout_cache_dir())
    missing_files = [name for name in ("config.json", "preprocessor_config.json") if not (cache_dir / name).is_file()]
    has_weights = (cache_dir / "model.safetensors").is_file() or (cache_dir / "pytorch_model.bin").is_file()
    if missing_files or not has_weights:
        raise TableExtractError(build_layout_model_prewarm_error())


def build_structure_model_prewarm_error(missing_files: list[str]) -> str:
    cache_dir = resolve_structure_cache_dir()
    warm_command = "make ocr-table-model-cache-warm"
    all_warm_command = "make ocr-table-cache-warm"
    missing = ", ".join(missing_files)
    return (
        "TATR structure 模型未预热完整，ocr-table-service 无法启动: "
        f"model={resolve_structure_model_name()}, cache_dir={cache_dir}, missing_files=[{missing}]. "
        f"请先执行 `{warm_command}` 预热默认 structure 模型，"
        f"或执行 `{all_warm_command}` 一次性预热 detection + structure + timm，"
        "目标宿主机目录为 `ocr-table-service/model_cache/table_extract/structure/`。"
    )


def build_structure_model_invalid_config_error(detail: str) -> str:
    cache_dir = resolve_structure_cache_dir()
    warm_command = "make ocr-table-model-cache-warm"
    all_warm_command = "make ocr-table-cache-warm"
    return (
        "TATR structure 模型缓存配置非法，ocr-table-service 无法启动: "
        f"model={resolve_structure_model_name()}, cache_dir={cache_dir}, detail={detail}. "
        f"请先执行 `{warm_command}` 重新预热默认 structure 模型，"
        f"或执行 `{all_warm_command}` 一次性预热 detection + structure + timm。"
    )


def ensure_structure_startup_prerequisites() -> None:
    model_name = resolve_structure_model_name()
    if model_name != DEFAULT_STRUCTURE_MODEL:
        return
    cache_dir = Path(resolve_structure_cache_dir())
    ensure_default_structure_support_files(cache_dir)
    missing_files = find_missing_default_structure_files(cache_dir)
    if missing_files:
        raise TableExtractError(build_structure_model_prewarm_error(missing_files))
    try:
        normalize_default_structure_config(cache_dir)
        normalize_default_structure_processor_configs(cache_dir)
    except Exception as exc:
        raise TableExtractError(build_structure_model_invalid_config_error(str(exc))) from exc


def ensure_timm_backbone_startup_prerequisites() -> None:
    cache_dir = resolve_hf_cache_dir()
    try:
        snapshot_download(
            repo_id=DEFAULT_TIMM_BACKBONE_MODEL,
            cache_dir=cache_dir,
            local_files_only=True,
        )
    except (LocalEntryNotFoundError, FileNotFoundError, OSError) as exc:
        raise TableExtractError(
            "TATR timm backbone 模型未预热，ocr-table-service 无法启动: "
            f"model={DEFAULT_TIMM_BACKBONE_MODEL}, cache_dir={cache_dir}. "
            "请先执行 `make ocr-table-cache-warm` 或 `make ocr-table-model-cache-warm`。"
        ) from exc
