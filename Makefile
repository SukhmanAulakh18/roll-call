# Roll Call — every claim has a target. Offline by default.
NODE ?= node
.PHONY: help test acceptance typecheck demo stack drill drill-release bench chaos exec-pack verify ui replay compose-up compose-down observe observe-otel slo slo-test k6 kind-up admission-demo clean print video tour

help: ## list targets
	@grep -E '^[a-z0-9-]+:.*##' Makefile | sed 's/:.*##/ —/'

test: ## unit tests
	npm run -s test
acceptance: ## Definition-of-Done acceptance tests
	npm run -s test:acceptance
typecheck: ## tsc --strict
	npm run -s typecheck

stack: ## run control + gateway + tools + fleet locally (no docker)
	$(NODE) scripts/serve.ts
ui: ## UI dev server (talks to `make stack`)
	cd ui && npm run dev
demo: ## offline demo: stack + built UI on http://localhost:7100
	cd ui && npm run -s build
	$(NODE) scripts/serve.ts --ui ui/dist

drill: ## >=20 A/B runaway drills + detector set -> impact.json
	$(NODE) scripts/drill.ts --runs 20
drill-release: ## bad-release (auto-rollback) and good-release (auto-promote) drills -> impact.json release section only
	$(NODE) scripts/drill.ts --only release
bench: ## decision-path latency vs ungoverned -> impact.json
	$(NODE) scripts/bench.ts
chaos: ## 5 game days: control stop, issuer down, gateway loss, bad bundle, event backlog -> impact.json
	$(NODE) scripts/chaos.ts
exec-pack: ## render exec-pack/ from impact.json (no hand-typed numbers)
	$(NODE) scripts/exec-pack.ts
verify: exec-pack ## chain verify, tamper test, every verification-matrix command, schema, forbidden strings
	$(NODE) scripts/verify.ts

compose-up: ## docker compose stack
	docker compose -f deploy/compose/docker-compose.yml up -d --build
compose-down:
	docker compose -f deploy/compose/docker-compose.yml --profile observability --profile otel down -v
observe: ## compose + Prometheus (:9090) + Grafana (:3000, dashboard "Roll Call — SLOs")
	docker compose -f deploy/compose/docker-compose.yml --profile observability up -d --build
observe-otel: ## observe + OTel collector (same targets, remote-write to Prometheus)
	docker compose -f deploy/compose/docker-compose.yml --profile observability --profile otel up -d --build
slo: ## slo/*.yaml -> Prometheus rules (deploy/observability/prometheus/rules/slo.rules.yml)
	$(NODE) scripts/slo-gen.ts
slo-test: slo ## promtool check + unit test of the burn-rate alerts (docker)
	docker run --rm --entrypoint promtool -v $(CURDIR)/deploy/observability/prometheus:/p prom/prometheus:v3.5.0 check rules /p/rules/slo.rules.yml /p/rules/invariants.rules.yml
	docker run --rm --entrypoint promtool -v $(CURDIR)/deploy/observability/prometheus:/p prom/prometheus:v3.5.0 test rules /p/tests/slo.test.yml
k6: ## 60 s open-model load on a running `make stack` (docker, host network) -> k6/summary.json
	docker run --rm --user $(shell id -u) --network host -v $(CURDIR)/k6:/k6 grafana/k6:1.3.0 run --summary-export /k6/summary.json /k6/gateway.js
	$(NODE) scripts/k6-merge.ts
kind-up: ## kind cluster + AgentRecord CRD + admission webhook
	bash deploy/k8s/kind-up.sh
admission-demo: ## try to run an unregistered agent in kind
	bash deploy/k8s/admission-demo.sh
a11y: ## axe-core on every UI route, real and fixture, both themes (run with `make demo` up)
	NODE_PATH=$(shell npm root -g) node ui/a11y.cjs
replay: ## build static Replay page from the last recorded run
	$(NODE) scripts/replay.ts
clean:
	rm -rf data ui/dist
print: ## A5 leave-behind PDF/PNG and print/pitch-numbers.md, all from impact.json
	$(NODE) print/build.ts
	NODE_PATH=$$(npm root -g) $(NODE) print/render.ts
video: ## record the real demo flow to docs/media/roll-call-demo.mp4 (run with `make demo` up)
	NODE_PATH=$$(npm root -g) $(NODE) scripts/record-demo.cjs
tour: ## record a full walkthrough of the live app to docs/media/roll-call-tour.mp4 (run with `make demo` up)
	NODE_PATH=$$(npm root -g) $(NODE) scripts/record-tour.cjs

.PHONY: external-demo containment
external-demo: ## genuine external agent (own OS process) is throttled, paged and killed; every retry denied -> impact.json external + replay/external-events.json
	$(NODE) scripts/external-demo.ts
containment: ## harder containment tests (concurrency, replay, bypass, in-flight, restart, arg tampering, false positives) -> impact.json containment, docs/containment.md table
	$(NODE) scripts/containment.ts
