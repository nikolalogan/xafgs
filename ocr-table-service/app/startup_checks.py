from pathlib import Path

from app.structure_cache import (
    ensure_default_structure_support_files,
    find_missing_default_structure_files,
    normalize_default_structure_config,
    normalize_default_structure_processor_configs,
)
from app.table_extract import (
    DEFAULT_LAYOUT_MODEL,
    DEFAULT_STRUCTURE_MODEL,
    TableExtractError,
    resolve_layout_cache_dir,
    resolve_layout_model_file_name,
    resolve_layout_model_name,
    resolve_structure_cache_dir,
    resolve_structure_model_name,
)


def build_layout_model_prewarm_error() -> str:
    cache_dir = resolve_layout_cache_dir()
    required_file = resolve_layout_model_file_name()
    warm_command = "make ocr-table-layout-model-cache-warm"
    return (
        "DocLayout-YOLO layout 模型未预热，ocr-table-service 无法启动: "
        f"model={resolve_layout_model_name()}, cache_dir={cache_dir}, required_file={required_file}. "
        f"请先执行 `{warm_command}` 预热到宿主机目录 `ocr-table-service/model_cache/table_extract/layout/`，"
        f"并确认 `{Path(cache_dir) / required_file}` 已存在后再启动服务。"
    )


def ensure_startup_prerequisites() -> None:
    ensure_layout_startup_prerequisites()
    ensure_structure_startup_prerequisites()


def ensure_layout_startup_prerequisites() -> None:
    model_name = resolve_layout_model_name()
    if model_name != DEFAULT_LAYOUT_MODEL:
        return
    required_path = Path(resolve_layout_cache_dir()) / resolve_layout_model_file_name()
    if required_path.is_file():
        return
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
        f"或执行 `{all_warm_command}` 一次性预热 layout + structure，"
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
        f"或执行 `{all_warm_command}` 一次性预热 layout + structure。"
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
