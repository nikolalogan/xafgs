import os
from pathlib import Path


DEFAULT_MODEL = "microsoft/table-transformer-structure-recognition-v1.1-pub"
REQUIRED_FILES = ("config.json", "preprocessor_config.json", "model.safetensors")


def resolve_model_name() -> str:
    return os.environ.get("TABLE_EXTRACT_STRUCTURE_MODEL", DEFAULT_MODEL).strip()


def resolve_target_dir() -> Path:
    root = Path(os.environ.get("TABLE_EXTRACT_MODEL_CACHE_DIR", "/app/model_cache/table_extract").strip())
    return root / "structure"


def is_cache_ready(target: Path) -> bool:
    return all((target / name).is_file() for name in REQUIRED_FILES)


def print_cache_summary(target: Path) -> None:
    for name in REQUIRED_FILES:
        path = target / name
        if path.is_file():
            print(f"TATR cache ready: {path}")


def main() -> None:
    model_name = resolve_model_name()
    target = resolve_target_dir()
    target.mkdir(parents=True, exist_ok=True)

    if is_cache_ready(target):
        print(f"TATR structure model already cached in {target}, skip download")
        print_cache_summary(target)
        return

    try:
        from huggingface_hub import snapshot_download
    except Exception as exc:
        raise RuntimeError("TATR 预热依赖未就绪，请安装 `huggingface_hub`") from exc

    endpoint = os.environ.get("HF_ENDPOINT", "").strip()
    if endpoint:
        print(f"Using Hugging Face endpoint: {endpoint}")

    snapshot_download(
        repo_id=model_name,
        local_dir=str(target),
        local_dir_use_symlinks=False,
        allow_patterns=list(REQUIRED_FILES),
    )

    if not is_cache_ready(target):
        missing = [name for name in REQUIRED_FILES if not (target / name).is_file()]
        raise RuntimeError(
            f"TATR 模型预热不完整: model={model_name}, target={target}, missing={','.join(missing)}"
        )

    print(f"TATR structure model downloaded into {target}")
    print_cache_summary(target)


if __name__ == "__main__":
    main()
