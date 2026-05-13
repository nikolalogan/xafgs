.PHONY: help menu dev dev-build dev-fresh dev-rebuild-backend dev-rebuild-backend-fresh macdev macdev-build macdev-fresh macdev-rebuild-backend macdev-rebuild-backend-fresh windev windev-build windev-fresh windev-rebuild-backend windev-rebuild-backend-fresh prod down dev-down prod-down logs ps menu-start-all menu-start-frontend menu-start-backend menu-start-gateway menu-start-postgres menu-start-redis menu-build-all menu-build-frontend menu-build-backend menu-build-gateway menu-build-postgres menu-build-redis

ifeq ($(OS),Windows_NT)
UNAME_S := Windows_NT
DEV_COMPOSE_FILE := docker-compose.dev.win.yml
else
UNAME_S := $(shell uname -s 2>/dev/null || echo Unknown)
ifeq ($(UNAME_S),Darwin)
DEV_COMPOSE_FILE := docker-compose.dev.mac.yml
else
DEV_COMPOSE_FILE := docker-compose.dev.yml
endif
endif

help:
	@echo "可用命令: make dev/dev-build/dev-fresh, make down, make logs, make ps"

ifeq ($(OS),Windows_NT)
menu: SHELL := powershell.exe
menu: .SHELLFLAGS := -ExecutionPolicy Bypass -Command
menu:
	& { .\scripts\dev-menu.ps1 "$(DEV_COMPOSE_FILE)" }
else
menu:
	bash scripts/dev-menu.sh "$(DEV_COMPOSE_FILE)"
endif

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

menu-start-all:
	docker compose -f $(DEV_COMPOSE_FILE) down
	docker compose -f $(DEV_COMPOSE_FILE) up -d
menu-start-frontend:
	docker compose -f $(DEV_COMPOSE_FILE) stop frontend
	docker compose -f $(DEV_COMPOSE_FILE) rm -f frontend
	docker compose -f $(DEV_COMPOSE_FILE) up -d frontend
menu-start-backend:
	docker compose -f $(DEV_COMPOSE_FILE) stop backend
	docker compose -f $(DEV_COMPOSE_FILE) rm -f backend
	docker compose -f $(DEV_COMPOSE_FILE) up -d backend
menu-start-gateway:
	docker compose -f $(DEV_COMPOSE_FILE) stop gateway
	docker compose -f $(DEV_COMPOSE_FILE) rm -f gateway
	docker compose -f $(DEV_COMPOSE_FILE) up -d gateway
menu-start-postgres:
	docker compose -f $(DEV_COMPOSE_FILE) stop postgres
	docker compose -f $(DEV_COMPOSE_FILE) rm -f postgres
	docker compose -f $(DEV_COMPOSE_FILE) up -d postgres
menu-start-redis:
	docker compose -f $(DEV_COMPOSE_FILE) stop redis
	docker compose -f $(DEV_COMPOSE_FILE) rm -f redis
	docker compose -f $(DEV_COMPOSE_FILE) up -d redis

menu-build-all:
	docker compose -f $(DEV_COMPOSE_FILE) build
menu-build-frontend:
	docker compose -f $(DEV_COMPOSE_FILE) build frontend
menu-build-backend:
	docker compose -f $(DEV_COMPOSE_FILE) build backend
menu-build-gateway:
	docker compose -f $(DEV_COMPOSE_FILE) build gateway
menu-build-postgres:
	docker compose -f $(DEV_COMPOSE_FILE) build postgres
menu-build-redis:
	docker compose -f $(DEV_COMPOSE_FILE) build redis
