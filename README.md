# Roll Call

Roll Call is a control room for a fleet of AI agents, with real governance controls behind it. It answers four questions about every agent:

1. **What is running?** Each agent has an inventory record with an owner, purpose, risk rating, scopes, budgets and evaluation evidence. Unregistered workloads are refused at admission.
2. **What is it doing and spending?** Every call goes through a gateway that records the decision and the cost.
3. **Is each action allowed, and is there a record?** Scope, budget, throttle and policy are checked on every call. Each decision is written to a hash-chained receipt that anyone can verify.
4. **Can we stop it, and can we prove it stopped?** A kill revokes the identity, stops the runtime and then runs an independent probe that replays the agent's last action and must see it denied.

The agents, tools and model responses are simulated. The controls are not. The gateway, registry, admission, budgets, detector, kill path and receipts are the code that a fault actually hits.

## Positioning

Roll Call builds on open-source work rather than replacing it:

| Piece | Used for |
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
npm install            # dev tooling only: TypeScript and Node types
make drill             # >= 20 runaway drills and detector set; writes impact.json
make demo              # offline demo: stack and built UI on http://localhost:7100
```

`make drill` writes `impact.json`. Read the measured results there. This README does not state them.

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
| `make bench` | Decision-path latency against the ungoverned baseline; writes `impact.json` |
| `make chaos` | Five game days (control stop, issuer down, gateway loss, bad bundle, event backlog); writes the `chaos` section of `impact.json` |
| `make exec-pack` | Render `exec-pack/` (briefs, verification matrix, threat model, E-23 mapping) from `impact.json` |
| `make verify` | Runs `exec-pack` first, then chain verification, tamper test, every verification-matrix command, schema check and forbidden-strings scan |
| `make replay` | Build a self-contained static Replay bundle in `dist-replay/` (open `#/replay`); `.github/workflows/pages.yml` publishes it to GitHub Pages so a QR code can open it on a phone |
| `make compose-up` / `make compose-down` | Docker compose stack, up and down |
| `make kind-up` | kind cluster with the AgentRecord CRD and admission webhook (planned) |
| `make admission-demo` | Try to run an unregistered agent in kind (planned) |
| `make clean` | Remove `data` and `ui/dist` |

The API is in `contracts/modules.md`. `make kind-up` and `make admission-demo` ran once against a real kube-apiserver; see ADR-013 for what was and was not exercised.

### How to read the numbers

Every figure comes from `impact.json`, written by a real run. Read them with these labels:

- **Overhead** is the difference of two end-to-end p99s (governed minus ungoverned), measured over loopback, plain HTTP, no TLS, in one process on one machine. It is not production latency.
- **Decision path p99** is an in-process timer around the decision code only.
- **Time to contain** includes a simulated owner acknowledgement (the configured delay is stored as `drill.simulatedOwnerAckMs`). The automatic part, time to hard throttle and page, is `drill.stagesP95Ms.paged`. Percentiles are over the recorded `drill.runs`.
- **Detector precision and recall** are for HARD containment only, with `detector.runsPerCase` runs per case. Soft alerts on negative cases are reported separately as `detector.softOnNegatives`.
- A kill counts as proven only when an independent probe gets DENY with code REVOKED; otherwise the incident stage is `kill_unconfirmed`.
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
| `deploy/k8s/` | Kubernetes manifests, CRD and admission (planned) |
| `docs/` | Architecture, ADRs, runbooks, FMEA, availability model, latency budget |
| `docs/adr/` | Architecture decision records, index in `docs/adr/README.md` |
| `docs/runbooks/` | Operator runbooks for the main failure modes |

Start with `docs/architecture.md`, then `docs/adr/README.md`.

## Honest limits

- **The fleet is simulated.** Agents are scripted, tools are mock bank services and model responses are recorded. Results show how the controls behave against these faults. They do not show how real agents would behave.
- **Drills are synthetic.** The faults are injected by our own runner, so detection rates describe those faults only. Precision and recall are measured on labelled drills, not on production traffic.
- **Laptop scale.** Runs are on one machine. Latency, throughput and availability figures are only comparable on the same kind of hardware.
- **Prices and hours saved are assumptions.** Per-call prices in the policy bundle are editable assumptions. Any savings or hours-saved figure is a model, not a measurement.
- **The gateway is a reference, not a security boundary.** Production should use agentgateway or an equivalent (ADR-001).
- **Receipts have no external anchor yet.** Tail truncation is not detected until chain heads are written to write-once storage (ADR-008).
- **OpenTelemetry GenAI conventions are in Development status** at the last check, so telemetry names are isolated in an adapter (ADR-009).
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
