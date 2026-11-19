# Roll Call — every claim has a target. Offline by default.
NODE ?= node
.PHONY: help test acceptance typecheck demo stack drill bench chaos exec-pack verify ui replay compose-up compose-down kind-up admission-demo clean print

help: ## list targets
	@grep -E '^[a-z-]+:.*##' Makefile | sed 's/:.*##/ —/'

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
	docker compose -f deploy/compose/docker-compose.yml down -v
kind-up: ## kind cluster + AgentRecord CRD + admission webhook
	bash deploy/k8s/kind-up.sh
admission-demo: ## try to run an unregistered agent in kind
	bash deploy/k8s/admission-demo.sh
replay: ## build static Replay page from the last recorded run
	$(NODE) scripts/replay.ts
clean:
	rm -rf data ui/dist
print: ## A5 leave-behind PDF/PNG and print/pitch-numbers.md, all from impact.json
	$(NODE) print/build.ts
	NODE_PATH=$$(npm root -g) $(NODE) print/render.ts
