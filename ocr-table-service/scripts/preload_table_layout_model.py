import os
from pathlib import Path

from huggingface_hub import snapshot_download

DEFAULT_REPO_ID = "microsoft/table-transformer-detection"


def main() -> None:
    repo_id = (os.environ.get("TABLE_EXTRACT_LAYOUT_MODEL") or DEFAULT_REPO_ID).strip() or DEFAULT_REPO_ID
    if repo_id != DEFAULT_REPO_ID:
        raise SystemExit(
            "仅支持预热默认 TATR detection 模型。"
            f" current={repo_id}, expected={DEFAULT_REPO_ID}"
        )
    root = Path(os.environ.get("TABLE_EXTRACT_MODEL_CACHE_DIR", "/app/model_cache/table_extract").strip())
    target_dir = root / "layout"
    target_dir.mkdir(parents=True, exist_ok=True)
    local_path = snapshot_download(
        repo_id=repo_id,
        allow_patterns=["config.json", "preprocessor_config.json", "model.safetensors", "pytorch_model.bin"],
        local_dir=str(target_dir),
        local_dir_use_symlinks=False,
    )
    print(f"detection model cached: {local_path}")


if __name__ == "__main__":
    main()
