.PHONY: help dev dev-build dev-fresh dev-rebuild-backend dev-rebuild-backend-fresh macdev macdev-build macdev-fresh macdev-rebuild-backend macdev-rebuild-backend-fresh windev windev-build windev-fresh windev-rebuild-backend windev-rebuild-backend-fresh prod down dev-down prod-down logs ps ocr-wheels-sync ocr-wheels-verify ocr-build ocr-build-offline ocr-build-online-fallback ocr-model-cache-init ocr-model-cache-warm docling-wheels-sync docling-model-cache-init docling-model-cache-warm docling-build docling-build-offline docling-build-online-fallback

UNAME_S := $(shell uname -s 2>/dev/null || echo Unknown)

ifeq ($(OS),Windows_NT)
DEV_COMPOSE_FILE := docker-compose.dev.win.yml
else ifeq ($(UNAME_S),Darwin)
DEV_COMPOSE_FILE := docker-compose.dev.mac.yml
else
DEV_COMPOSE_FILE := docker-compose.dev.yml
endif

help:
	@echo "可用命令:"
	@echo "  make macdev    # macOS 开发模式快速启动（不默认构建）"
	@echo "  make macdev-build # macOS 开发模式启动并构建镜像"
	@echo "  make macdev-fresh # macOS 无缓存重建 backend 后启动"
	@echo "  make windev    # Windows 开发模式快速启动（不默认构建）"
	@echo "  make windev-build # Windows 开发模式启动并构建镜像"
	@echo "  make windev-fresh # Windows 无缓存重建 backend 后启动"
	@echo "  当前开发编排文件: $(DEV_COMPOSE_FILE)"
	@echo "  make dev       # 兼容旧命令，等同 macdev"
	@echo "  make dev-build # 兼容旧命令，等同 macdev-build"
	@echo "  make dev-fresh # 兼容旧命令，等同 macdev-fresh"
	@echo "  make dev-rebuild-backend # 缓存重建开发后端镜像"
	@echo "  make dev-rebuild-backend-fresh # 无缓存重建开发后端镜像"
	@echo "  make ocr-wheels-sync # 同步 OCR 依赖到本地 wheels 缓存目录"
	@echo "  make ocr-wheels-verify # 校验 wheels 是否可离线覆盖依赖闭包"
	@echo "  make ocr-model-cache-init # 初始化本地 OCR 模型缓存目录"
	@echo "  make ocr-model-cache-warm # 预热本地 OCR 模型缓存到 model_cache"
	@echo "  make ocr-build # 自动同步+校验 wheels，再离线构建 OCR 镜像（推荐）"
	@echo "  make ocr-build-offline # 仅使用本地 wheels 构建 OCR 镜像（缺包即失败）"
	@echo "  make ocr-build-online-fallback # 自动同步 wheels 后构建 OCR 镜像（允许缺包回源）"
	@echo "  make docling-wheels-sync # 同步 Docling Python 依赖到本地 wheels 缓存目录"
	@echo "  make docling-model-cache-init # 初始化本地 Docling 模型缓存目录"
	@echo "  make docling-model-cache-warm # 预热本地 Docling 模型缓存到 model_cache"
	@echo "  make docling-build # 自动同步+预热后离线构建 Docling 镜像（推荐）"
	@echo "  make docling-build-offline # 仅使用本地 wheels 构建 Docling 镜像"
	@echo "  make docling-build-online-fallback # 自动同步 wheels 后构建 Docling 镜像（允许缺包回源）"
	@echo "  make prod      # 生产模式启动"
	@echo "  make down      # 停止开发+生产所有容器"
	@echo "  make dev-down  # 仅停止开发模式容器"
	@echo "  make prod-down # 仅停止生产模式容器"
	@echo "  make logs      # 查看开发模式日志"
	@echo "  make ps        # 查看容器状态"

dev: macdev

dev-build: macdev-build

dev-fresh: macdev-fresh

dev-rebuild-backend: macdev-rebuild-backend

dev-rebuild-backend-fresh: macdev-rebuild-backend-fresh

macdev:
	docker compose -f docker-compose.dev.mac.yml up

macdev-build:
	docker compose -f docker-compose.dev.mac.yml up --build

macdev-fresh: macdev-rebuild-backend-fresh
	docker compose -f docker-compose.dev.mac.yml up --build

macdev-rebuild-backend:
	docker compose -f docker-compose.dev.mac.yml build backend

macdev-rebuild-backend-fresh:
	docker compose -f docker-compose.dev.mac.yml build --no-cache backend

windev:
	docker compose -f docker-compose.dev.win.yml up

windev-build:
	docker compose -f docker-compose.dev.win.yml up --build

windev-fresh: windev-rebuild-backend-fresh
	docker compose -f docker-compose.dev.win.yml up --build

windev-rebuild-backend:
	docker compose -f docker-compose.dev.win.yml build backend

windev-rebuild-backend-fresh:
	docker compose -f docker-compose.dev.win.yml build --no-cache backend

ocr-wheels-sync:
	bash ocr-service/scripts/download_wheels.sh

ocr-wheels-verify:
	bash ocr-service/scripts/verify_wheels.sh

ocr-model-cache-init:
	mkdir -p ocr-service/model_cache

ocr-model-cache-warm: ocr-model-cache-init
	docker compose -f $(DEV_COMPOSE_FILE) run --rm ocr-service python /app/scripts/preload_models.py

ocr-build: ocr-model-cache-init ocr-wheels-sync ocr-wheels-verify
	OCR_WHEELS_ONLY=1 docker compose -f $(DEV_COMPOSE_FILE) build ocr-service

ocr-build-offline: ocr-model-cache-init ocr-wheels-verify
	OCR_WHEELS_ONLY=1 docker compose -f $(DEV_COMPOSE_FILE) build ocr-service

ocr-build-online-fallback: ocr-model-cache-init ocr-wheels-sync
	OCR_WHEELS_ONLY=0 docker compose -f $(DEV_COMPOSE_FILE) build ocr-service

docling-wheels-sync:
	bash docling-service/scripts/download_wheels.sh

docling-model-cache-init:
	mkdir -p docling-service/model_cache

docling-model-cache-warm: docling-model-cache-init docling-wheels-sync
	DOCLING_WHEELS_ONLY=0 docker compose -f $(DEV_COMPOSE_FILE) build docling-service
	docker compose -f $(DEV_COMPOSE_FILE) run --rm -e HF_HUB_OFFLINE=0 -e TRANSFORMERS_OFFLINE=0 -e HF_ENDPOINT=$${HF_ENDPOINT:-https://hf-mirror.com} docling-service python scripts/preload_models.py

docling-build: docling-model-cache-init docling-wheels-sync docling-model-cache-warm
	DOCLING_WHEELS_ONLY=1 docker compose -f $(DEV_COMPOSE_FILE) build docling-service

docling-build-offline: docling-model-cache-init
	DOCLING_WHEELS_ONLY=1 docker compose -f $(DEV_COMPOSE_FILE) build docling-service

docling-build-online-fallback: docling-model-cache-init docling-wheels-sync
	DOCLING_WHEELS_ONLY=0 docker compose -f $(DEV_COMPOSE_FILE) build docling-service

prod:
	docker compose up --build -d

down: dev-down prod-down

dev-down:
	docker compose -f $(DEV_COMPOSE_FILE) down

prod-down:
	docker compose down

logs:
	docker compose -f $(DEV_COMPOSE_FILE) logs -f

ps:
	docker compose -f $(DEV_COMPOSE_FILE) ps
	docker compose ps
