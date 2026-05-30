# Get absolute project path
PROJECT_ROOT := $(shell pwd)
INFRA_PATH := $(PROJECT_ROOT)/.infra
VOLUME_PATH := $(PROJECT_ROOT)/.data

# Environment file selection
ENV ?= local
ENV_FILE := $(INFRA_PATH)/env/.env.$(ENV)

# Load environment-specific file if it exists
ifneq (,$(wildcard $(ENV_FILE)))
    include $(ENV_FILE)
    export
endif

# Container runtime detection (OrbStack > Podman > Docker)
CONTAINER_RUNTIME ?= $(shell \
	if docker context ls 2>/dev/null | grep -q orbstack; then echo docker; \
	elif which podman >/dev/null 2>&1; then echo podman; \
	else echo docker; fi)

DATABASE_PATH := $(INFRA_PATH)/database
MIGRATIONS_PATH := $(DATABASE_PATH)/migration
COMPOSE := $(CONTAINER_RUNTIME) compose \
	--project-directory $(PROJECT_ROOT) \
	--env-file $(ENV_FILE) \
	-f $(INFRA_PATH)/docker/docker-compose.yaml \
	-p $(PROJECT)

.PHONY: help env-show env-validate volume-init container-up container-down container-ps container-logs container-wait container-clean flyway-migrate flyway-info flyway-validate flyway-repair

help: ## Show this help message
	@echo "Available Commands:"
	@echo "==================="
	@awk 'BEGIN {FS = ":.*?## "; printf "\n"} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "Usage Examples:"
	@echo "  make container-up            # Start local PostgreSQL"
	@echo "  make flyway-migrate          # Run Flyway migrations"
	@echo "  make container-down          # Stop local containers"
	@echo ""
	@echo "Available Environments: local (default)"

env-show: ## Show current environment variables
	@echo "Current Environment Variables:"
	@echo "=============================="
	@echo "Environment:           $(ENV)"
	@echo "Environment file:      $(ENV_FILE)"
	@echo "Runtime:               $(CONTAINER_RUNTIME)"
	@echo "Project:               $(PROJECT)"
	@echo "DB Host:               $(DB_HOST)"
	@echo "DB Port:               $(DB_PORT)"
	@echo "DB Name:               $(DB_NAME)"
	@echo "DB Username:           $(DB_USERNAME)"
	@echo "Flyway Schemas:        $(FLYWAY_SCHEMAS)"
	@echo "Flyway Default Schema: $(FLYWAY_DEFAULT_SCHEMA)"
	@echo "Volume Path:           $(VOLUME_PATH)"

env-validate: ## Validate required environment variables
	@test -f "$(ENV_FILE)" || (echo "Missing environment file: $(ENV_FILE)" && exit 1)
	@test -n "$(PROJECT)" || (echo "PROJECT not set" && exit 1)
	@test -n "$(DB_HOST)" || (echo "DB_HOST not set" && exit 1)
	@test -n "$(DB_PORT)" || (echo "DB_PORT not set" && exit 1)
	@test -n "$(DB_NAME)" || (echo "DB_NAME not set" && exit 1)
	@test -n "$(DB_USERNAME)" || (echo "DB_USERNAME not set" && exit 1)
	@test -n "$(DB_PASSWORD)" || (echo "DB_PASSWORD not set" && exit 1)
	@test -n "$(FLYWAY_SCHEMAS)" || (echo "FLYWAY_SCHEMAS not set" && exit 1)
	@test -n "$(FLYWAY_DEFAULT_SCHEMA)" || (echo "FLYWAY_DEFAULT_SCHEMA not set" && exit 1)
	@echo "All required variables are set."

volume-init: ## Initialize local volume directories
	@mkdir -p $(VOLUME_PATH)/postgresql
	@echo "Volume directories created."

container-up: env-validate volume-init ## Start local PostgreSQL
	@echo "Starting PostgreSQL with $(CONTAINER_RUNTIME) ($(ENV))..."
	@$(COMPOSE) up -d postgres
	@echo "PostgreSQL started."

container-down: ## Stop local containers
	@echo "Stopping containers with $(CONTAINER_RUNTIME) ($(ENV))..."
	@$(COMPOSE) down
	@echo "Containers stopped."

container-ps: ## Show local containers
	@$(COMPOSE) ps

container-logs: ## Tail PostgreSQL logs
	@$(COMPOSE) logs -f postgres

container-wait: env-validate ## Wait until PostgreSQL accepts connections
	@echo "Waiting for PostgreSQL..."
	@for i in $$(seq 1 30); do \
		if $(COMPOSE) exec -T postgres pg_isready -U "$(DB_USERNAME)" -d "$(DB_NAME)" >/dev/null 2>&1; then \
			echo "PostgreSQL is ready."; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "PostgreSQL did not become ready in time."; \
	exit 1

container-clean: container-down ## Remove local database files and reinitialize
	@rm -rf $(VOLUME_PATH)
	@$(MAKE) volume-init
	@echo "Local volumes cleaned and reinitialized."

flyway-migrate: container-up container-wait ## Run database migrations
	@echo "Running Flyway migrate ($(ENV))..."
	@$(COMPOSE) run --rm flyway migrate
	@echo "Database migrations completed."

flyway-info: container-up container-wait ## Show Flyway migration status
	@$(COMPOSE) run --rm flyway info

flyway-validate: container-up container-wait ## Validate Flyway migrations
	@$(COMPOSE) run --rm flyway validate

flyway-repair: container-up container-wait ## Repair Flyway schema history
	@$(COMPOSE) run --rm flyway repair
