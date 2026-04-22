#!/usr/bin/env bash

set -euo pipefail

DEV_COMPOSE_FILE="${1:-${DEV_COMPOSE_FILE:-docker-compose.dev.yml}}"

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
  echo "  2) 打包菜单"
  echo "  3) 停止开发环境"
  echo "  4) 查看开发日志"
  echo "  5) 查看容器状态"
  echo "  6) 同步 OCR wheels"
  echo "  7) 同步 Docling wheels"
  echo "  0) 退出"
  echo
}

show_build_menu() {
  echo "请选择打包操作:"
  echo "  1) 打包所有"
  echo "  2) 打包并启动"
  echo "  3) 单独打包 OCR"
  echo "  4) 单独打包 Docling"
  echo "  0) 返回上级"
  echo
}

pause_menu() {
  echo
  read -r -p "按回车键返回菜单..." _
}

build_all() {
  mkdir -p ocr-service/model_cache docling-service/model_cache
  bash ocr-service/scripts/verify_wheels.sh
  OCR_WHEELS_ONLY=1 DOCLING_WHEELS_ONLY=1 run_compose build
}

build_up() {
  mkdir -p ocr-service/model_cache docling-service/model_cache
  bash ocr-service/scripts/verify_wheels.sh
  OCR_WHEELS_ONLY=1 DOCLING_WHEELS_ONLY=1 run_compose up --build
}

show_build_submenu() {
  while true; do
    show_header
    show_build_menu
    read -r -p "输入打包选项编号: " build_choice
    build_choice="${build_choice%$'\r'}"

    case "$build_choice" in
      1)
        build_all
        pause_menu
        ;;
      2)
        build_up
        ;;
      3)
        mkdir -p ocr-service/model_cache
        bash ocr-service/scripts/verify_wheels.sh
        OCR_WHEELS_ONLY=1 run_compose build ocr-service
        pause_menu
        ;;
      4)
        mkdir -p docling-service/model_cache
        DOCLING_WHEELS_ONLY=1 run_compose build docling-service
        pause_menu
        ;;
      0)
        return
        ;;
      *)
        echo "无效选项: $build_choice"
        pause_menu
        ;;
    esac
  done
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
      show_build_submenu
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
    0)
      exit 0
      ;;
    *)
      echo "无效选项: $choice"
      pause_menu
      ;;
  esac
done
