from __future__ import annotations

import os
import sys


def main() -> int:
    try:
        from paddlex import create_pipeline
    except Exception as exc:
        print(f"skip preload: paddlex runtime unavailable: {exc}")
        return 0

    pipeline = os.getenv("OCR_V3_PIPELINE", "PP-StructureV3").strip() or "PP-StructureV3"
    default_device = os.getenv("OCR_V3_DEVICE", "cpu").strip() or "cpu"
    device = os.getenv("OCR_PRELOAD_DEVICE", "").strip() or default_device
    try:
        create_pipeline(pipeline, device=device)
    except Exception as exc:
        print(
            "skip preload: create_pipeline failed, continue build:",
            {
                "pipeline": pipeline,
                "device": device,
                "error": str(exc),
            },
        )
        return 0
    print(
        "preload success:",
        {
            "pipeline": pipeline,
            "paddlex_home": os.getenv("PADDLEX_HOME", "").strip(),
            "device": device,
        },
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
