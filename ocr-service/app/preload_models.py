from __future__ import annotations

import os
import sys

from app.providers.local_pp_structure import LocalPPStructureProvider


def main() -> int:
    provider = LocalPPStructureProvider()
    if not provider.is_configured():
        print("skip preload: local pp-structure is disabled")
        return 0

    preload_tables = os.getenv("OCR_PPSTRUCTURE_ENABLE_TABLES", "1").strip() in {"1", "true", "True", "yes", "on"}
    provider._get_pipeline(enable_tables=preload_tables)
    print(
        "preload success:",
        {
            "enable_tables": preload_tables,
            "paddlex_home": os.getenv("PADDLEX_HOME", "").strip(),
            "model_root": os.getenv("OCR_PPSTRUCTURE_MODEL_ROOT", "").strip(),
        },
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
