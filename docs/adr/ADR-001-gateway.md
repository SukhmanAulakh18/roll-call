# ADR-001: Gateway (data plane between agents and tools/LLMs)

Status: Accepted (spike, 2026-11-19)

## Context
Roll Call must run fully offline via docker compose. Every simulated agent call needs per-agent attribution, a per-agent rate limit/budget, and an instant per-agent kill driven by our control plane, with no gateway restart.

## Options
1. agentgateway (Apache 2.0, Rust; HTTP, MCP and LLM proxy), as the real data plane.
2. Thin TypeScript reference gateway (Node 22) behind a `Gateway` interface, with agentgateway as a later production adapter.

## Decision
Build option 2 now. The interface covers `forward(call)`, `setPolicy(agentId, {rate, budget})` and `kill(agentId)`. Name agentgateway as the production data-plane option and keep a compose profile for it. The reference gateway works the same on every laptop and reads control-plane state directly, so the kill switch and budgets are simple and testable.

## Consequences
- We own a small proxy (about 200 lines) and must keep its semantics honest as a reference, not a security boundary.
- Per-agent rate limit and kill are straightforward in-process. With agentgateway they would be synced through its config, so the adapter has to generate that config.
- The ghcr image is not an offline-friendly route in this environment. Ship the release binary or mirror the image.

## Evidence (what I ran)
- `gh api .../releases/latest` and the API URL: 403 "GitHub access not enabled" (sandbox restriction, not a product issue). `git ls-remote --tags` worked and showed v1.7.0.
- `curl -L .../releases/download/v1.7.0/agentgateway-linux-amd64`: HTTP 200, 96 MB static musl binary. `ag --version` reports 1.7.0.
- `docker pull ghcr.io/agentgateway/agentgateway:v1.7.0`: manifest OK, blob download blocked by the proxy (pkg-containers.githubusercontent.com). I did not get the image.
- First run failed with `bind [::]:3000: Address family not supported (os error 97)`: it binds IPv6 unconditionally. Setting `IPV6_ENABLED=false` fixed it. Note this for docker/IPv6-less hosts.
- Config: YAML with `binds/listeners/routes`, `authorization` (CEL rule `request.headers["x-agent-id"] != "agent-killed"`) and `localRateLimit` (maxTokens 3, requests). `--validate-only`: valid.
- Observed: 5 requests with `x-agent-id: agent-a` returned 200,200,200,429,429. `agent-killed` returned 403.
- Hot reload: the file is watched. Editing the deny rule in cfg.yaml and waiting 4s flipped results with no restart (previously denied id allowed with 200, new id denied with 403). Log: "loaded config from File".
- Not verified: `localRateLimit` is per route, not per agent. Per-agent keyed limits need `remoteRateLimit` (an external rate-limit service) or one route per agent, which I did not test. The binary also contains budget and JWT, extAuthz and XDS strings, and I did not exercise them. Per-agent attribution via header works. JWT identity was not tested.
- Verdict: agentgateway is viable. Per-agent kill by config hot-reload is proven. A per-agent budget is unproven.

## Addendum: the ungoverned baseline (`/v1/direct`)
The reference gateway can serve `POST /v1/direct`, which skips identity, scope, budget, throttle and masking. It exists only to measure the ungoverned baseline (`make bench`, A/B drills).
- Off by default: it answers 404 unless the gateway is started with `directEnabled: true` or the environment variable `RC_DIRECT_BASELINE=1`. The in-process simulation stack (`sim/stack.ts`, used by bench, drills and the demo) turns it on; compose sets it for the demo gateways only.
- Every direct call is still recorded: an action event with `governed: false` and a `direct:<gateway>:<n>` receipt id goes to the control plane and shows in the UI. It is not appended to the gateway's hash chain (the chain covers governed decisions only).
- It is not a security boundary. Nothing in this repo forces agents through the gateway at the network layer (no NetworkPolicy or egress control yet); in production the baseline flag must stay off.
