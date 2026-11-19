# Module contracts (in-process API). Tests import these exact paths.

All backend code: TypeScript run directly by Node 22 (native type stripping). No build step.
Imports use `.ts` extensions. Zero runtime deps for backend (node:http, node:crypto, node:fs).

| Module | Export | Behaviour |
|---|---|---|
| `services/control/src/app.ts` | `startControl(opts: {port?: number; dataDir: string; seedFile?: string; clock?: () => number}): Promise<ControlHandle>` | Registry, identity issuer, bundle, events ingest, incident engine, SSE, admission, kill+probe, drills API. `port: 0` = ephemeral. |
| | `ControlHandle = {url: string; close(): Promise<void>; registry; engine}` | |
| `services/gateway/src/app.ts` | `startGateway(opts: {port?: number; controlUrl: string; toolsUrl: string; gatewayId: string; dataDir: string; pollMs?: number}): Promise<{url: string; close(): Promise<void>}>` | authN -> revoked? -> scope -> budget/throttle -> policy (stale bundle => high-risk fail closed) -> mask -> forward -> receipt -> event. `POST /v1/direct` = ungoverned baseline (no checks, still measured, `governed:false`). |
| `services/control/src/admission.ts` | `admit(w: WorkloadSpec, records: AgentRecord[]): AdmissionResult` | Pure. Deny: no label, no record, record missing owner, no scopes, retired, production/canary without passing evaluation. Plain-English reason. |
| `services/control/src/detector.ts` | `createDetector(cfg?)` -> `{observe(e: ActionEvent): void; evaluate(now: number): Finding[]}` | Pure/deterministic. Signal 1: rate ratio vs agent's own robust baseline (median). Signal 2: repeat signature (tool+argsHash) or A2A cycle. 1 signal => soft; 2 => hard. Scope drift => finding. |
| `services/gateway/src/receipts.ts` | `verifyChain(file: string): {ok: boolean; count: number; brokenAt?: number; reason?: string}` | Recompute hashes; report first bad seq. |
| `services/control/src/identity.ts` | `issueToken(agentId, ttlMs)`, `verifyToken(token)` | HMAC-signed, short-lived, SPIFFE-style subject `spiffe://rollcall.local/agent/<id>`. |
| `sim/tools.ts` | `startTools(opts:{port?: number})` | Mock bank tools (ledger.read, payments.transfer, kyc.lookup, docs.search, llm.complete with recorded responses from `sim/recorded-llm.json`, agent.call...). Deterministic. |
| `sim/fleet.ts` | `FLEET: AgentRecord[]` (12 agents, banking-flavoured, fictional) and `startFleet(...)` | Scripted agents with baseline behaviour; faults injectable. |
| `sim/stack.ts` | `startStack(opts:{dataDir: string; gateways?: number}): Promise<Stack>` | Starts tools, control, N gateways, fleet in-process on ephemeral ports. `Stack = {control, gateways, tools, fleet, close}`. |
| `sim/drills.ts` | `runDrill(stack, name, mode): Promise<DrillResult>` | Names: runaway-loop, ping-pong, scope-drift, healthy-burst (negative), slow-repeat (soft only), normal (negative). |
| `scripts/drill.ts` | CLI | Runs >= 20 governed+ungoverned runaway pairs + detector set; writes `impact.json` drill + detector sections. |
| `scripts/bench.ts` | CLI | Decision-path latency p50/95/99, throughput, overhead vs `/v1/direct`; writes `impact.json` bench section. |

HTTP API: see `contracts/openapi.yaml`. Events: `contracts/types.ts` (`ActionEvent`, `IncidentEvent`, `StreamMessage`).

## Control-plane HTTP (port 7100 in compose)
- `GET /v1/agents`, `GET /v1/agents/:id`, `POST /v1/agents` (register; same validation as admission)
- `POST /v1/identity/token` `{agentId}` -> `{token, expiresAt, spiffeId}`; refused if revoked/unregistered
- `GET /v1/bundle` -> `PolicyBundle`
- `POST /v1/events` `{events: ActionEvent[]}`
- `GET /v1/stream` SSE of `StreamMessage`
- `GET /v1/incidents`
- `POST /v1/agents/:id/kill` -> revoke identity + stop runtime + independent probe; returns `IncidentEvent` with `proof`
- `POST /v1/admission/review` -> `AdmissionResult` (also accepts k8s `AdmissionReview` v1 and answers in kind)
- `POST /v1/drills/:name` `{mode}` -> `DrillResult`
- `GET /v1/impact` -> contents of `impact.json`
- `GET /v1/receipts/verify` -> per-gateway `verifyChain` result
- `GET /healthz`

## Gateway HTTP (port 7200+)
- `POST /v1/act` (ActRequest -> ActResponse), `POST /v1/direct`, `GET /healthz`, `GET /metrics` (Prometheus text)
