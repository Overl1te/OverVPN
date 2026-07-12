.PHONY: install dev build migrate migrate-dev bootstrap-admin test test-e2e lint typecheck format compose-up compose-down

install:
	pnpm install

dev:
	pnpm dev

build:
	pnpm build

migrate:
	pnpm migrate

migrate-dev:
	pnpm migrate:dev

bootstrap-admin:
	pnpm bootstrap:admin

test:
	pnpm test

test-e2e:
	pnpm test:e2e

lint:
	pnpm lint

typecheck:
	pnpm typecheck

format:
	pnpm format

compose-up:
	pnpm compose-up

compose-down:
	pnpm compose-down
