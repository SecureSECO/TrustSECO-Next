DOCKER ?= docker
COMPOSE = $(DOCKER) compose --env-file .env -f deploy/compose.yaml
.PHONY: up stop status logs test
up:
	$(COMPOSE) up -d --build
stop:
	$(COMPOSE) stop
status:
	$(COMPOSE) ps
logs:
	$(COMPOSE) logs --tail=100 -f
test:
	$(COMPOSE) exec -T web node --test test/measurements.cjs test/score-inputs.cjs
	$(COMPOSE) exec -T dlt npm run lint
	$(COMPOSE) exec -T dlt npm test -- --runInBand
	$(COMPOSE) exec -T dlt node test/gpg-registration.cjs
	$(COMPOSE) exec -T dlt node test/score-subsets.cjs
