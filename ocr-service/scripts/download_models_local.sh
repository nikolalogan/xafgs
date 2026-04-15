#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_CACHE_DIR="${ROOT_DIR}/model_cache"
VENV_DIR="${ROOT_DIR}/.tmp/model-download-venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
PIP_INDEX_URL="${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple}"
PIP_TRUSTED_HOST="${PIP_TRUSTED_HOST:-mirrors.aliyun.com}"
PIP_DEFAULT_TIMEOUT="${PIP_DEFAULT_TIMEOUT:-600}"
PIP_RETRIES="${PIP_RETRIES:-10}"
PADDLE_PDX_MODEL_SOURCE="${PADDLE_PDX_MODEL_SOURCE:-aistudio}"
VERIFY_ENABLED=1
CLEAN_ENABLED=0

usage() {
  cat <<'EOF'
用法:
  ./ocr-service/scripts/download_models_local.sh [--clean] [--no-verify]

说明:
  - 在本机创建隔离 venv 并下载 PP-StructureV3 所需模型到:
      ocr-service/model_cache
  - 不在容器内执行下载

参数:
  --clean      下载前清理 model_cache/official_models
  --no-verify  下载后跳过目录校验
EOF
}

for arg in "$@"; do
  case "$arg" in
    --clean)
      CLEAN_ENABLED=1
      ;;
    --no-verify)
      VERIFY_ENABLED=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: ${arg}"
      usage
      exit 2
      ;;
  esac
done

if [[ "${CLEAN_ENABLED}" -eq 1 ]]; then
  TARGET_DIR="${MODEL_CACHE_DIR}/official_models"
  echo "即将清理目录: ${TARGET_DIR}"
  read -r -p "请输入 YES 确认清理: " confirm
  if [[ "${confirm}" != "YES" ]]; then
    echo "已取消清理。"
    exit 1
  fi
  rm -rf "${TARGET_DIR}"
fi

mkdir -p "${MODEL_CACHE_DIR}" "${ROOT_DIR}/.tmp"

echo "[1/4] 创建本地 venv: ${VENV_DIR}"
"${PYTHON_BIN}" -m venv "${VENV_DIR}"
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

echo "[2/4] 安装下载依赖（本机 venv）"
python -m pip install --upgrade pip setuptools wheel
python -m pip install \
  --index-url "${PIP_INDEX_URL}" \
  --trusted-host "${PIP_TRUSTED_HOST}" \
  --retries "${PIP_RETRIES}" \
  --timeout "${PIP_DEFAULT_TIMEOUT}" \
  "paddlex==3.4.3" \
  "pyyaml>=6,<7"

echo "[3/4] 下载模型到本地目录: ${MODEL_CACHE_DIR}"
export PADDLEX_HOME="${MODEL_CACHE_DIR}"
export PADDLE_PDX_CACHE_HOME="${MODEL_CACHE_DIR}"
export PADDLE_PDX_MODEL_SOURCE="${PADDLE_PDX_MODEL_SOURCE}"
unset PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK

python - <<'PY'
import importlib.util
import os
from pathlib import Path

import yaml

cache_home = os.environ["PADDLE_PDX_CACHE_HOME"]
model_source = os.environ.get("PADDLE_PDX_MODEL_SOURCE", "aistudio")
print(f"cache_home={cache_home}")
print(f"model_source={model_source}")

spec = importlib.util.find_spec("paddlex")
if spec is None or spec.origin is None:
    raise RuntimeError("无法定位 paddlex 包，请检查本机 venv 依赖安装。")

paddlex_root = Path(spec.origin).resolve().parent
pipeline_config = paddlex_root / "configs" / "pipelines" / "PP-StructureV3.yaml"
if not pipeline_config.exists():
    raise RuntimeError(f"缺少 pipeline 配置文件: {pipeline_config}")

def collect_model_names(node):
    names = set()
    if isinstance(node, dict):
        model_name = node.get("model_name")
        if isinstance(model_name, str) and model_name.strip():
            names.add(model_name.strip())
        for value in node.values():
            names.update(collect_model_names(value))
    elif isinstance(node, list):
        for value in node:
            names.update(collect_model_names(value))
    return names

config = yaml.safe_load(pipeline_config.read_text(encoding="utf-8"))
model_names = sorted(collect_model_names(config))
if not model_names:
    raise RuntimeError("未从 PP-StructureV3 配置中解析到模型列表。")

from paddlex.inference.utils.official_models import official_models

print(f"将下载 {len(model_names)} 个模型：")
for model_name in model_names:
    print(f"- {model_name}")

for idx, model_name in enumerate(model_names, start=1):
    print(f"[{idx}/{len(model_names)}] downloading {model_name}")
    local_dir = official_models[model_name]
    print(f"[{idx}/{len(model_names)}] ready {model_name} -> {local_dir}")

print("模型下载完成。")
PY

if [[ "${VERIFY_ENABLED}" -eq 1 ]]; then
  echo "[4/4] 校验关键模型目录"
  BASE="${MODEL_CACHE_DIR}/official_models"
  required_models=(
    "PP-DocBlockLayout"
    "PP-DocLayout_plus-L"
    "PP-OCRv5_server_det"
    "PP-OCRv5_server_rec"
    "PP-LCNet_x1_0_textline_ori"
    "PP-LCNet_x1_0_table_cls"
    "SLANet_plus"
    "SLANeXt_wired"
    "RT-DETR-L_wired_table_cell_det"
    "RT-DETR-L_wireless_table_cell_det"
    "PP-FormulaNet_plus-L"
  )
  for model in "${required_models[@]}"; do
    model_dir="${BASE}/${model}"
    if [[ ! -d "${model_dir}" ]]; then
      echo "缺少模型目录: ${model_dir}"
      exit 1
    fi
    if [[ -z "$(find "${model_dir}" -mindepth 1 -maxdepth 2 -type f -print -quit)" ]]; then
      echo "模型目录为空: ${model_dir}"
      exit 1
    fi
    echo "已存在: ${model_dir}"
  done
fi

echo "完成。模型缓存目录大小:"
du -sh "${MODEL_CACHE_DIR}" || true
