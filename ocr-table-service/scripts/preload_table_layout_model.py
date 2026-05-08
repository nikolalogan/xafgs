import os
from pathlib import Path

from huggingface_hub import hf_hub_download

DEFAULT_MODEL_FILE = "doclayout_yolo_docstructbench_imgsz1024.pt"
DEFAULT_REPO_ID = "juliozhao/DocLayout-YOLO-DocStructBench"


def main() -> None:
    repo_id = (os.environ.get("TABLE_EXTRACT_LAYOUT_MODEL") or DEFAULT_REPO_ID).strip() or DEFAULT_REPO_ID
    if repo_id != DEFAULT_REPO_ID:
        raise SystemExit(
            "仅支持预热默认 DocLayout-YOLO layout 模型。"
            f" current={repo_id}, expected={DEFAULT_REPO_ID}"
        )
    filename = (os.environ.get("TABLE_EXTRACT_LAYOUT_MODEL_FILE") or DEFAULT_MODEL_FILE).strip() or DEFAULT_MODEL_FILE
    root = Path(os.environ.get("TABLE_EXTRACT_MODEL_CACHE_DIR", "/app/model_cache/table_extract").strip())
    target_dir = root / "layout"
    target_dir.mkdir(parents=True, exist_ok=True)
    local_path = hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=str(target_dir),
        local_dir_use_symlinks=False,
    )
    print(f"layout model cached: {local_path}")


if __name__ == "__main__":
    main()
