import os
import subprocess
from pathlib import Path


def get_target() -> Path:
    raw = os.environ.get("DOCLING_ARTIFACTS_PATH", "/opt/docling-models").strip()
    return Path(raw)


def get_layout_candidates(target: Path) -> list[Path]:
    return [
        target / "model_artifacts" / "layout",
        target / "layout",
        target / "models" / "layout",
        target / "docling-project--docling-layout-heron",
        target,
    ]


def get_table_candidates(target: Path) -> list[Path]:
    return [
        target / "docling-project--docling-models" / "model_artifacts" / "tableformer",
        target / "model_artifacts" / "tableformer",
        target / "tableformer",
    ]


def find_layout_artifacts(target: Path) -> Path | None:
    for candidate in get_layout_candidates(target):
        if (candidate / "model.safetensors").is_file():
            return candidate
    for candidate in sorted(target.glob("*layout*")):
        if (candidate / "model.safetensors").is_file():
            return candidate
    return None


def find_table_artifacts(target: Path) -> Path | None:
    for candidate in get_table_candidates(target):
        if (
            (candidate / "accurate" / "tableformer_accurate.safetensors").is_file()
            or (candidate / "fast" / "tableformer_fast.safetensors").is_file()
        ):
            return candidate
    return None


def print_cache_summary(target: Path) -> None:
    layout_artifacts = find_layout_artifacts(target)
    table_artifacts = find_table_artifacts(target)
    if layout_artifacts is not None and table_artifacts is not None:
        print(f"Docling layout artifacts ready: {layout_artifacts / 'model.safetensors'}")
        accurate = table_artifacts / "accurate" / "tableformer_accurate.safetensors"
        fast = table_artifacts / "fast" / "tableformer_fast.safetensors"
        if accurate.is_file():
            print(f"Docling table artifacts ready: {accurate}")
        if fast.is_file():
            print(f"Docling table artifacts ready: {fast}")
        return

    found = sorted(target.glob("**/model.safetensors"))
    if found:
        raise RuntimeError(
            "Docling model cache contains model.safetensors, but required layout/table artifacts are not all in supported directories. "
            f"Found: {', '.join(str(path) for path in found)}. "
            f"Checked layout candidates: {', '.join(str(path) for path in get_layout_candidates(target))}. "
            f"Checked table candidates: {', '.join(str(path) for path in get_table_candidates(target))}. "
            "请重新运行 make docling-model-cache-warm"
        )

    raise RuntimeError(
        "Docling model cache is incomplete. "
        f"Checked layout candidates: {', '.join(str(path) for path in get_layout_candidates(target))}. "
        f"Checked table candidates: {', '.join(str(path) for path in get_table_candidates(target))}. "
        "请重新运行 make docling-model-cache-warm"
    )


def main() -> None:
    target = get_target()
    target.mkdir(parents=True, exist_ok=True)
    layout_artifacts = find_layout_artifacts(target)
    if layout_artifacts is not None:
        print(f"Docling models already cached in {target}, skip download")
        print_cache_summary(target)
        return

    env = os.environ.copy()
    env["DOCLING_ARTIFACTS_PATH"] = str(target)
    env["DOCLING_SERVE_ARTIFACTS_PATH"] = str(target)
    env.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    print(f"Using Hugging Face mirror endpoint: {env['HF_ENDPOINT']}")
    subprocess.run(
        ["docling-tools", "models", "download", "--output-dir", str(target)],
        env=env,
        check=True,
    )
    print(f"Docling models downloaded into {target}")
    print_cache_summary(target)


if __name__ == "__main__":
    main()
