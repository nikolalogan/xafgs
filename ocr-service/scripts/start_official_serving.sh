#!/usr/bin/env bash
set -euo pipefail

SERVE_HOST="${OCR_API_HOST:-0.0.0.0}"
SERVE_PORT="${PORT:-8090}"
PIPELINE="${OCR_V3_PIPELINE:-PP-StructureV3}"
DEVICE="${OCR_V3_DEVICE:-cpu}"

echo "Starting PaddleX official serving..."
echo "  host=${SERVE_HOST}"
echo "  port=${SERVE_PORT}"
echo "  pipeline=${PIPELINE}"
echo "  device=${DEVICE}"
echo "  paddle_package=${OCR_PADDLE_PACKAGE:-paddlepaddle-gpu}"
python -c "import importlib; \
paddle=importlib.import_module('paddle'); \
paddlex=importlib.import_module('paddlex'); \
print('  paddle_version=' + getattr(paddle, '__version__', 'unknown')); \
print('  paddlex_version=' + getattr(paddlex, '__version__', 'unknown'))"

paddlex --install serving
exec paddlex --serve --pipeline "${PIPELINE}" --host "${SERVE_HOST}" --port "${SERVE_PORT}" --device "${DEVICE}"
