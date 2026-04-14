#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHEELS_DIR="${ROOT_DIR}/wheels"
REQ_FILE="${ROOT_DIR}/requirements.txt"
CONSTRAINTS_FILE="${ROOT_DIR}/constraints.txt"

PIP_INDEX_URL="${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple}"
PIP_TRUSTED_HOST="${PIP_TRUSTED_HOST:-mirrors.aliyun.com}"
PLATFORMS="${WHEEL_PLATFORMS:-manylinux1_x86_64 manylinux2014_x86_64 manylinux_2_17_x86_64 manylinux_2_28_x86_64}"
PYTHON_VERSION="${WHEEL_PYTHON_VERSION:-311}"
IMPLEMENTATION="${WHEEL_IMPLEMENTATION:-cp}"
PIP_RETRIES="${PIP_RETRIES:-10}"
PIP_TIMEOUT="${PIP_DEFAULT_TIMEOUT:-600}"

mkdir -p "${WHEELS_DIR}"

for platform in ${PLATFORMS}; do
  echo "Syncing wheels for platform: ${platform}"
  python3 -m pip download \
    --dest "${WHEELS_DIR}" \
    --only-binary=:all: \
    --prefer-binary \
    --platform "${platform}" \
    --python-version "${PYTHON_VERSION}" \
    --implementation "${IMPLEMENTATION}" \
    --index-url "${PIP_INDEX_URL}" \
    --trusted-host "${PIP_TRUSTED_HOST}" \
    --retries "${PIP_RETRIES}" \
    --timeout "${PIP_TIMEOUT}" \
    -r "${REQ_FILE}" \
    -c "${CONSTRAINTS_FILE}"
done

critical=(
  "paddlepaddle-3.2.0"
  "paddleocr-3.4.0"
  "paddlex-3.4"
  "opencv_contrib_python-4.10.0.84"
)
for pattern in "${critical[@]}"; do
  if ! find "${WHEELS_DIR}" -maxdepth 1 -type f -name "${pattern}*.whl" | grep -q .; then
    echo "Missing critical wheel: ${pattern}*.whl"
    echo "Current wheel count: $(find "${WHEELS_DIR}" -maxdepth 1 -type f -name '*.whl' | wc -l | tr -d ' ')"
    exit 1
  fi
done

echo "Wheel sync complete: ${WHEELS_DIR}"
