from __future__ import annotations

import os
import sys

def main() -> int:
    try:
        from paddlex import create_pipeline
    except Exception as exc:
        print(f"skip preload: paddlex runtime unavailable: {exc}")
        return 0

    pipeline = os.getenv("OCR_PDX_PIPELINE", "PP-StructureV3").strip() or "PP-StructureV3"
    device = os.getenv("OCR_PPSTRUCTURE_DEVICE", "cpu").strip() or "cpu"
    create_pipeline(pipeline, device=device)
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
