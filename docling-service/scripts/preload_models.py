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
        target,
    ]


def find_layout_artifacts(target: Path) -> Path | None:
    for candidate in get_layout_candidates(target):
        if (candidate / "model.safetensors").is_file():
            return candidate
    return None


def print_cache_summary(target: Path) -> None:
    layout_artifacts = find_layout_artifacts(target)
    if layout_artifacts is not None:
        print(f"Docling layout artifacts ready: {layout_artifacts / 'model.safetensors'}")
        return

    found = sorted(target.glob("**/model.safetensors"))
    if found:
        raise RuntimeError(
            "Docling model cache contains model.safetensors, but not in supported layout directories. "
            f"Found: {', '.join(str(path) for path in found)}. "
            f"Checked candidates: {', '.join(str(path) for path in get_layout_candidates(target))}. "
            "请重新运行 make docling-model-cache-warm"
        )

    raise RuntimeError(
        "Docling model cache is incomplete. "
        f"Checked candidates: {', '.join(str(path) for path in get_layout_candidates(target))}. "
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
