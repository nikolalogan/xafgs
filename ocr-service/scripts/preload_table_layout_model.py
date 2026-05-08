import os
from pathlib import Path


DEFAULT_MODEL = "juliozhao/DocLayout-YOLO-DocStructBench"
DEFAULT_MODEL_FILE = "doclayout_yolo_docstructbench_imgsz1024.pt"


def resolve_model_name() -> str:
    return os.environ.get("TABLE_EXTRACT_LAYOUT_MODEL", DEFAULT_MODEL).strip()


def resolve_model_file_name() -> str:
    return os.environ.get("TABLE_EXTRACT_LAYOUT_MODEL_FILE", DEFAULT_MODEL_FILE).strip()


def resolve_target_dir() -> Path:
    root = Path(os.environ.get("TABLE_EXTRACT_MODEL_CACHE_DIR", "/app/model_cache/table_extract").strip())
    return root / "layout"


def resolve_target_file(target_dir: Path) -> Path:
    return target_dir / resolve_model_file_name()


def is_cache_ready(target_dir: Path) -> bool:
    return resolve_target_file(target_dir).is_file()


def print_cache_summary(target_dir: Path) -> None:
    target_file = resolve_target_file(target_dir)
    if target_file.is_file():
        print(f"DocLayout-YOLO cache ready: {target_file}")


def main() -> None:
    model_name = resolve_model_name()
    target_dir = resolve_target_dir()
    target_dir.mkdir(parents=True, exist_ok=True)

    if is_cache_ready(target_dir):
        print(f"DocLayout-YOLO layout model already cached in {target_dir}, skip download")
        print_cache_summary(target_dir)
        return

    try:
        from huggingface_hub import hf_hub_download
    except Exception as exc:
        raise RuntimeError("DocLayout-YOLO 预热依赖未就绪，请安装 `huggingface_hub`") from exc

    endpoint = os.environ.get("HF_ENDPOINT", "").strip()
    if endpoint:
        print(f"Using Hugging Face endpoint: {endpoint}")

    try:
        downloaded = hf_hub_download(
            repo_id=model_name,
            filename=resolve_model_file_name(),
            local_dir=str(target_dir),
            local_dir_use_symlinks=False,
        )
    except Exception as exc:
        raise RuntimeError(
            f"DocLayout-YOLO 预热失败: model={model_name}, target={target_dir}, detail={exc}"
        ) from exc

    if not is_cache_ready(target_dir):
        raise RuntimeError(
            f"DocLayout-YOLO 预热不完整: model={model_name}, target={target_dir}, "
            f"missing={resolve_model_file_name()}, downloaded={downloaded}"
        )

    print(f"DocLayout-YOLO layout model downloaded into {target_dir}")
    print_cache_summary(target_dir)


if __name__ == "__main__":
    main()
