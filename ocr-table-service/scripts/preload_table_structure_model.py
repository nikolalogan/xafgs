import os
import sys
from pathlib import Path

from huggingface_hub import snapshot_download


APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.structure_cache import (
    find_missing_default_structure_files,
    normalize_default_structure_config,
    normalize_default_structure_processor_configs,
    ensure_default_structure_support_files,
)

DEFAULT_MODEL_ID = "microsoft/table-transformer-structure-recognition"
DEFAULT_TIMM_MODEL_ID = "timm/resnet18.a1_in1k"


def main() -> None:
    model_id = (os.environ.get("TABLE_EXTRACT_STRUCTURE_MODEL") or DEFAULT_MODEL_ID).strip() or DEFAULT_MODEL_ID
    if model_id != DEFAULT_MODEL_ID:
        raise SystemExit(
            "仅支持预热默认 TATR structure 模型。"
            f" current={model_id}, expected={DEFAULT_MODEL_ID}"
        )
    root = Path(os.environ.get("TABLE_EXTRACT_MODEL_CACHE_DIR", "/app/model_cache/table_extract").strip())
    target_dir = root / "structure"
    target_dir.mkdir(parents=True, exist_ok=True)
    local_dir = snapshot_download(
        repo_id=model_id,
        local_dir=str(target_dir),
        local_dir_use_symlinks=False,
        allow_patterns=["config.json", "preprocessor_config.json", "processor_config.json", "model.safetensors", "pytorch_model.bin"],
    )
    snapshot_download(repo_id=DEFAULT_TIMM_MODEL_ID)
    ensure_default_structure_support_files(target_dir)
    missing_files = find_missing_default_structure_files(target_dir)
    if missing_files:
        raise SystemExit(
            "TATR structure 模型预热不完整: "
            f"model={model_id}, cache_dir={target_dir}, missing_files={missing_files}"
        )
    try:
        normalize_default_structure_config(target_dir)
        normalize_default_structure_processor_configs(target_dir)
    except Exception as exc:
        raise SystemExit(
            "TATR structure 模型缓存配置修复失败: "
            f"model={model_id}, cache_dir={target_dir}, detail={exc}"
        ) from exc
    print(f"structure+timm model cached: {local_dir}")


if __name__ == "__main__":
    main()
