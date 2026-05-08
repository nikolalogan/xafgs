import sys
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.startup_checks import ensure_startup_prerequisites


def main() -> None:
    ensure_startup_prerequisites()


if __name__ == "__main__":
    main()
