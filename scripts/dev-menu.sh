#!/usr/bin/env bash

set -euo pipefail

DEV_COMPOSE_FILE="${DEV_COMPOSE_FILE:-docker-compose.dev.yml}"

run_compose() {
  docker compose -f "$DEV_COMPOSE_FILE" "$@"
}

show_header() {
  echo
  echo "项目开发菜单"
  echo "当前开发编排文件: $DEV_COMPOSE_FILE"
  echo
}

show_menu() {
  echo "请选择操作:"
  echo "  1) 开发启动"
  echo "  2) 构建并启动（默认离线，缺 wheels 直接失败）"
  echo "  3) 停止开发环境"
  echo "  4) 查看开发日志"
  echo "  5) 查看容器状态"
  echo "  6) 同步 OCR wheels"
  echo "  7) 同步 Docling wheels"
  echo "  8) 离线构建 OCR"
  echo "  9) 离线构建 Docling"
  echo "  0) 退出"
  echo
}

pause_menu() {
  echo
  read -r -p "按回车键返回菜单..." _
}

while true; do
  show_header
  show_menu
  read -r -p "输入选项编号: " choice
  choice="${choice%$'\r'}"

  case "$choice" in
    1)
      run_compose up
      ;;
    2)
      run_compose up --build
      ;;
    3)
      run_compose down
      pause_menu
      ;;
    4)
      run_compose logs -f
      ;;
    5)
      run_compose ps
      docker compose ps
      pause_menu
      ;;
    6)
      bash ocr-service/scripts/download_wheels.sh
      pause_menu
      ;;
    7)
      bash docling-service/scripts/download_wheels.sh
      pause_menu
      ;;
    8)
      mkdir -p ocr-service/model_cache
      bash ocr-service/scripts/verify_wheels.sh
      OCR_WHEELS_ONLY=1 run_compose build ocr-service
      pause_menu
      ;;
    9)
      mkdir -p docling-service/model_cache
      DOCLING_WHEELS_ONLY=1 run_compose build docling-service
      pause_menu
      ;;
    0)
      exit 0
      ;;
    *)
      echo "无效选项: $choice"
      pause_menu
      ;;
  esac
done
