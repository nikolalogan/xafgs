#!/usr/bin/env bash
set -euo pipefail

PIPELINE_NAME="${OCR_PDX_PIPELINE:-PP-StructureV3}"
SERVE_HOST="${OCR_PDX_SERVE_HOST:-0.0.0.0}"
SERVE_PORT="${PORT:-8090}"
SERVE_DEVICE="${OCR_PPSTRUCTURE_DEVICE:-cpu}"
INSTALL_SERVING="${OCR_PDX_INSTALL_SERVING:-0}"

if [[ "${INSTALL_SERVING}" == "1" ]]; then
  echo "Installing PaddleX serving plugin..."
  paddlex --install serving
fi

echo "Starting PaddleX serving..."
echo "  pipeline=${PIPELINE_NAME}"
echo "  host=${SERVE_HOST}"
echo "  port=${SERVE_PORT}"
echo "  device=${SERVE_DEVICE}"

exec paddlex --serve \
  --pipeline "${PIPELINE_NAME}" \
  --device "${SERVE_DEVICE}" \
  --host "${SERVE_HOST}" \
  --port "${SERVE_PORT}"
