#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHEELS_DIR="${ROOT_DIR}/wheels"
REQ_FILE="${ROOT_DIR}/requirements.txt"
CONSTRAINTS_FILE="${ROOT_DIR}/constraints.txt"

PLATFORMS="${WHEEL_PLATFORMS_VERIFY:-manylinux_2_17_x86_64}"
PYTHON_VERSION="${WHEEL_PYTHON_VERSION:-311}"
IMPLEMENTATION="${WHEEL_IMPLEMENTATION:-cp}"

if [ ! -d "${WHEELS_DIR}" ]; then
  echo "Missing wheels directory: ${WHEELS_DIR}"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

for platform in ${PLATFORMS}; do
  echo "Verifying wheel closure for platform: ${platform}"
  python3 -m pip download \
    --dest "${TMP_DIR}" \
    --no-index \
    --find-links "${WHEELS_DIR}" \
    --only-binary=:all: \
    --prefer-binary \
    --platform "${platform}" \
    --python-version "${PYTHON_VERSION}" \
    --implementation "${IMPLEMENTATION}" \
    -r "${REQ_FILE}" \
    -c "${CONSTRAINTS_FILE}" >/dev/null
done

echo "Wheel verify passed: ${WHEELS_DIR}"
