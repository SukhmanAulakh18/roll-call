# Roll Call

Roll Call is a control room for a fleet of AI agents, with real governance controls behind it. It answers four questions about every agent:

1. **What is running?** Each agent has an inventory record with an owner, purpose, risk rating, scopes, budgets and evaluation evidence. Unregistered workloads are refused at admission.
2. **What is it doing and spending?** Every call goes through a gateway that records the decision and the cost.
3. **Is each action allowed, and is there a record?** Scope, budget, throttle and policy are checked on every call. Each decision is written to a hash-chained receipt that anyone can verify.
4. **Can we stop it, and can we prove it stopped?** A kill revokes the identity, stops the runtime and then runs an independent probe that replays the agent's last action and must see it denied.

The agents, tools and model responses are simulated. The controls are not. The gateway, registry, admission, budgets, detector, kill path and receipts are the code that a fault actually hits.

## Positioning

Roll Call builds on open-source work rather than replacing it:

| Piece | Design option for (not a dependency) |
|---|---|
| agentgateway | Production data-plane option for HTTP, MCP and LLM traffic (ADR-001) |
| kagent | Kubernetes runtime for agents |
| agent-sandbox | Isolated runtime for agent workloads |
| Microsoft Agent Governance Toolkit | Policy and governance primitives; an adapter option (ADR-002) |
| A2A | Agent-to-agent calls; the cycle detector reads these |
| MCP | Tool protocol the gateway can front |
| SPIFFE | Identity format for agents (`spiffe://rollcall.local/agent/<id>`); SPIRE in production (ADR-005) |
| Langfuse | LLM-level traces |

What Roll Call adds: **the control loop and the proof.** Detection, graded response (soft throttle, hard throttle and page, kill), a kill that is verified from outside, and receipts that show the record was not changed. Those are the parts most agent stacks leave to the operator.

## Quickstart

Requires Node 22 (the backend runs TypeScript directly, with no build step). Docker is optional.

```bash
npm ci                 # dev tooling only: TypeScript, Node types, qrcode
(cd ui && npm ci)      # UI build tooling and bundle dependencies
make demo              # offline demo: builds the UI, serves stack and UI on http://localhost:7100
```

The committed `impact.json` holds the last recorded run, so `make demo` needs no drill first. To re-measure, run `make drill` (and `make drill-release`, `make bench`, `make chaos` as needed), then `make exec-pack` and `make print` so the briefs and leave-behind match. Read the measured results in `impact.json`. This README does not state them.

To run the containers instead: `make compose-up`, then `make compose-down` to stop and remove volumes.

## Make targets

| Target | What it does |
|---|---|
| `make help` | List targets |
| `make test` | Unit tests |
| `make acceptance` | Definition-of-Done acceptance tests |
| `make typecheck` | `tsc --strict` |
| `make stack` | Run control, gateway, tools and fleet locally, without Docker |
| `make ui` | UI dev server (talks to `make stack`) |
| `make demo` | Build the UI and serve the offline demo on port 7100 |
| `make drill` | At least 20 governed and ungoverned runaway drills, and the detector set; writes `impact.json` |
| `make drill-release` | Bad-release (auto-rollback) and good-release (auto-promote) drills; writes only the `release` section of `impact.json`. One simulated fault kind |
| `make bench` | Decision-path latency against the ungoverned baseline; writes `impact.json` |
| `make chaos` | Five game days (control stop, issuer down, gateway loss, bad bundle, event backlog); writes the `chaos` section of `impact.json` |
| `make exec-pack` | Render `exec-pack/` (briefs, verification matrix, threat model, E-23 mapping) from `impact.json` |
| `make verify` | Runs `exec-pack` first, then chain verification, tamper test, every verification-matrix command, schema check and forbidden-strings scan |
| `make replay` | Build a self-contained static Replay bundle in `dist-replay/` (open `#/replay`); `.github/workflows/pages.yml` publishes it to GitHub Pages so a QR code can open it on a phone |
| `make compose-up` / `make compose-down` | Docker compose stack, up and down |
| `make observe` | Compose plus Prometheus :9090 and Grafana :3000 (SLO dashboard); see `docs/slo.md` |
| `make observe-otel` | `observe` plus an OTel collector that scrapes the same targets and remote-writes to Prometheus |
| `make slo` | Generate Prometheus burn-rate rules from `slo/*.yaml` |
| `make slo-test` | `make slo`, then `promtool check` and unit test of the alerts (Docker) |
| `make k6` | 60 s open-model load test against a running `RC_TICK_MS=0 make stack`, which turns incident detection off; merges `bench.k6` into impact.json. Its numbers are for the decision path with detection disabled |
| `make kind-up` | kind cluster with the AgentRecord CRD and admission webhook (see ADR-013 for what was exercised) |
| `make admission-demo` | Try to run an unregistered agent in kind (see ADR-013) |
| `make print` | A5 leave-behind (`print/leave-behind.pdf`, `.png`) and `print/pitch-numbers.md`, all from impact.json |
| `make clean` | Remove `data` and `ui/dist` |

The API is in `contracts/modules.md`. `make kind-up` and `make admission-demo` ran once against a real kube-apiserver: the CRD and the label check (ValidatingAdmissionPolicy) were exercised; the record-lookup webhook was not (ADR-013).

### How to read the numbers

Every figure comes from `impact.json`, written by a real run. Read them with these labels:

- **Overhead** is the difference of two end-to-end p99s (governed minus ungoverned), measured over loopback, plain HTTP, no TLS, in one process on one machine. It is not production latency.
- **Decision path p99** is an in-process timer around the decision code only.
- **Time to contain** includes a simulated owner acknowledgement (the configured delay is stored as `drill.simulatedOwnerAckMs`). The automatic part, time to hard throttle and page, is `drill.stagesP95Ms.paged`. Percentiles are over the recorded `drill.runs`.
- **Detector precision and recall** are for HARD containment only, with `detector.runsPerCase` runs per case. Soft alerts on negative cases are reported separately as `detector.softOnNegatives`.
- A kill counts as proven only when an independent probe gets DENY with code REVOKED; otherwise the incident stage is `kill_unconfirmed`.
- **k6 load figures** (`bench.k6`) were measured with incident detection off (`RC_TICK_MS=0`), because the detector would otherwise throttle the load as a runaway. Same loopback, no-TLS, one-machine caveat.
- **Release drills** (`release`) inject one simulated fault kind (failing requests) into one agent; latency and scope regressions are gated but not drilled (ADR-014).
- `/v1/direct` (the ungoverned baseline) is off unless `RC_DIRECT_BASELINE=1` (ADR-001).

## Repo map

| Path | Contents |
|---|---|
| `contracts/` | Single source of truth: `types.ts`, `modules.md` (module and HTTP API), `impact.schema.json` |
| `services/control/` | Registry, identity issuer, policy bundle, events, incidents, admission, kill and probe, drills API |
| `services/gateway/` | Data plane: authN, scope, budget, throttle, policy, masking, forward, receipts |
| `sim/` | Simulated fleet, mock tools, recorded model responses, fault injection |
| `scripts/` | CLIs: `serve`, `drill`, `bench`, `chaos`, `verify`, `replay` |
| `ui/` | Control room UI |
| `replay/` | Static Replay page source |
| `tests/acceptance/` | Definition-of-Done tests |
| `deploy/compose/` | Docker compose topology and image |
| `deploy/k8s/` | Kubernetes manifests, CRD and admission (ADR-013); Argo Rollouts design in `rollouts/` (not exercised) |
| `deploy/observability/`, `slo/`, `k6/` | Prometheus, Grafana and OTel config; OpenSLO definitions; k6 load script |
| `print/` | Leave-behind and pitch numbers, generated from impact.json |
| `docs/` | Architecture, ADRs, runbooks, FMEA, availability model, latency budget |
| `docs/adr/` | Architecture decision records, index in `docs/adr/README.md` |
| `docs/runbooks/` | Operator runbooks for the main failure modes |

Start with `docs/architecture.md`, then `docs/adr/README.md`.

## Honest limits

- **The fleet is simulated.** Agents are scripted, tools are mock business services and model responses are recorded. Results show how the controls behave against these faults. They do not show how real agents would behave.
- **Drills are synthetic.** The faults are injected by our own runner, so detection rates describe those faults only. Precision and recall are measured on labelled drills, not on production traffic.
- **Laptop scale.** Runs are on one machine. Latency, throughput and availability figures are only comparable on the same kind of hardware.
- **Prices and hours saved are assumptions.** Per-call prices in the policy bundle are editable assumptions. Any savings or hours-saved figure is a model, not a measurement.
- **The gateway is a reference, not a security boundary.** Production should use agentgateway or an equivalent (ADR-001).
- **Receipts have no external anchor yet.** Tail truncation is not detected until chain heads are written to write-once storage (ADR-008).
- **OpenTelemetry GenAI conventions are in Development status** at the last check, so telemetry names are isolated in an adapter (ADR-009).
- **The OWASP agentic threat-model titles are provisional**, pending reconciliation with the official OWASP text.
- **The E-23 mapping is an interpretation** of the guideline's inventory and model-risk expectations. It is not legal, regulatory or compliance advice.
- **Not affiliated with or endorsed by any company or regulator named here.** Named projects are referenced, and each keeps its own licence.

## Licences

| Component | Licence | Verified (date and source) |
|---|---|---|
| Roll Call code | TBD | TBD |
| Valkey | TBD (verify, ADR-012) | TBD |
| OpenTofu | TBD (verify, ADR-012) | TBD |
| agentgateway | TBD | TBD |
| kagent | TBD | TBD |
| agent-sandbox | TBD | TBD |
| Microsoft Agent Governance Toolkit | TBD | TBD |
| Langfuse | TBD | TBD |
| SPIFFE / SPIRE | TBD | TBD |

Licences are to be verified before adoption. Do not treat this table as final.

## Deploy

**Live app (one container, whole stack).** `deploy/Dockerfile.web` builds the UI and runs control, gateway, tools and the simulated fleet in one process, serving the UI and API on `$PORT`.

- Render: Dashboard → New → Blueprint → pick this repo (`render.yaml`). Free plan; health check `/healthz`.
- Any container host: `docker build -f deploy/Dockerfile.web -t roll-call . && docker run -p 7100:7100 roll-call`, then open http://localhost:7100.

Free hosts sleep when idle, so the first request after a pause can take ~30–60 s, and state resets on restart (the fleet always boots healthy). For the event itself, run it locally with `make demo` — it is offline-first.

**Replay (static).** Settings → Pages → Source: GitHub Actions; the `pages` workflow then publishes `make replay` output to https://sukhmanaulakh18.github.io/roll-call/.
