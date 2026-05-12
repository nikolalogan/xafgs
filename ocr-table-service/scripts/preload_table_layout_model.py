import os
from pathlib import Path

from huggingface_hub import snapshot_download

DEFAULT_REPO_ID = "microsoft/table-transformer-detection"


def _build_network_error_message(exc: Exception) -> str:
    endpoint = (os.environ.get("HF_ENDPOINT") or "https://huggingface.co").strip()
    hf_hub_offline = (os.environ.get("HF_HUB_OFFLINE") or "").strip()
    transformers_offline = (os.environ.get("TRANSFORMERS_OFFLINE") or "").strip()
    mode = "offline" if hf_hub_offline == "1" or transformers_offline == "1" else "online"
    return (
        "TATR detection 模型预热失败，疑似网络或镜像源不可用: "
        f"endpoint={endpoint}, mode={mode}, detail={exc}. "
        "请检查网络后重试 `make ocr-table-layout-model-cache-warm`，"
        "或设置可用的 HF_ENDPOINT 后重试。"
    )


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
    try:
        local_path = snapshot_download(
            repo_id=repo_id,
            allow_patterns=["config.json", "preprocessor_config.json", "model.safetensors", "pytorch_model.bin"],
            local_dir=str(target_dir),
        )
    except Exception as exc:
        raise SystemExit(_build_network_error_message(exc)) from exc
    print(f"detection model cached: {local_path}")


if __name__ == "__main__":
    main()
