# Roll Call: technical brief

Numbers are from the last recorded run: impact.json generatedAt 2026-11-19T07:19:06.564Z, gitSha 1a8d073 (chaos section run at 2026-11-19T07:19:06.564Z). generatedAt is the time of the latest merge into impact.json; sections run earlier keep their own measurements. The fleet, tools and model responses are simulated; the controls are real code. Results are from one laptop-class machine (see impact.json environment).

## Architecture (C4 summary)

Full diagrams: [`docs/architecture.md`](../docs/architecture.md). In short: a **control plane** (registry, identity issuer, policy bundle, incident engine, admission, kill and probe) and a **data plane** of gateway replicas that every agent call passes through (authN, revocation, scope, budget and throttle, policy, masking, forward, receipt). The backend has zero runtime dependencies (`node:*` only). Decisions are in `docs/adr/`.

## Non-functional requirements: target vs measured

| Requirement | Target | Measured | Field |
|---|---|---|---|
| Gateway decision path p99 | at most 50 ms | 0.0901 ms | `bench.governed.p99` |
| Overhead vs ungoverned, p99 (end to end) | not set | 0.87 ms | `bench.overheadP99Ms` |
| Time to detect, p95 | at most 10000 ms | 752 ms | `drill.stagesP95Ms.detected` |
| Time to contain, p95 (over 20 drills) | at most 30000 ms | 2225 ms | `drill.timeToContainMs.p95` |
| Time to contain, p50 | not set | 2026 ms | `drill.timeToContainMs.p50` |
| Spend kept out per runaway drill, mean | not set | $0.66 | `drill.spendProtectedUsd.protectedMean` |
| Detector false alarms / missed | none | 0 / 0 | `detector.fp`, `detector.fn` |
| Data plane availability | 99.95% (target) | not measured as a percentage; see game days below | docs/availability-model.md |
| Control plane availability | 99.9% (target) | not measured as a percentage; see game days below | docs/availability-model.md |

## Control plane and data plane, and static stability

Gateways act on a cached policy bundle and poll control in the background (ADR-004). If control is unreachable, low-risk calls continue; once the bundle is older than the staleness limit (2000 ms in these runs), high-risk tools are refused with `STALE_POLICY_HIGH_RISK`. No new identities or admissions are possible while control is down. Game days (`make chaos`, in-process, same machine as the benchmarks):

| Game day | Result | Fields |
|---|---|---|
| Control plane stopped, then restarted | Low-risk success ratio 1.00; high-risk denied after the bundle went stale: 1.00; gateway marked it stale (MTTD) 2008 ms after the stop; normal operation (MTTR) 13 ms after restart; new identity and admission refused during the outage. | `chaos.scenarios.control-plane-stop` |
| Identity issuer fails | Token TTL in this test 3000 ms; latest first denial 2107 ms after the fault; calls allowed on an expired token 0; agents recovered without a restart. | `chaos.scenarios.identity-issuer-down` |
| One of two gateway replicas killed | Error rate after the loss: 0.50 without agent-side failover, 0.00 with it. **Finding:** the fleet had no failover and sent about half its calls to the dead replica; the fix retries the other replica only on connection refused. | `chaos.scenarios.gateway-replica-loss` |
| Malformed or rejected policy bundle | Lowest low-risk success ratio across four variants 1.00; last good bundle kept in every variant: true. **Finding:** a well-formed but wrong-shaped bundle used to replace the good one and break the gateway; the gateway now validates the shape (`services/gateway/src/app.ts`, unit test in `gateway.test.ts`). | `chaos.scenarios.bad-policy-bundle` |
| Event endpoint hangs | Decision success ratio 1.00 during the fault; 408 events dropped and counted at the buffer bound; delivered plus dropped equals decisions: true. | `chaos.scenarios.telemetry-backlog` |

Each game day records its hypothesis, steady state, blast radius, abort condition and recovery in impact.json. Limits: the faults are injected in-process (not Chaos Mesh on a cluster); the gateway close is graceful, not a crash; a revocation issued during a control outage cannot reach gateways (ADR-004, accepted limit).

## Failure modes

The qualitative analysis is [`docs/FMEA.md`](../docs/FMEA.md) (copy: `FMEA.md`). Each row names the make target that exercises it; rows marked "planned" have no test and are not claimed. Runbooks: `docs/runbooks/`. Latency and availability method: `latency-budget.md`, `availability-model.md`.

## Capacity note

The bench ran 6000 requests at concurrency 16 on a machine with 4 cores, which also ran the load generator, the mock tools and control: 2279 req/s through one gateway. The simulated fleet generates 17 calls/s. This is a laptop-scale measurement, not a capacity plan. Production sizing needs a load test against a deployed gateway (the design names k6) and a decision on the production data plane (agentgateway, ADR-001). After one of two replicas dies, the survivor takes all the traffic; headroom per replica has not been measured.

## Licences of dependencies actually used

Read from the package manifests and installed packages. The backend has no runtime dependencies. Container base images and the Valkey image in `deploy/compose` are not listed; Valkey is planned, not used by the code (ADR-012). The open-source projects named in the CEO brief are design options and are not dependencies of this repository.

| Package | Version | Licence (from its package.json) | Where |
|---|---|---|---|
| `typescript` | 5.9.3 | Apache-2.0 | backend dev tooling only (type check) |
| `@types/node` | 22.19.1 | MIT | backend dev tooling only (type check) |
| `@fontsource-variable/hanken-grotesk` | 5.3.0 | OFL-1.1 | UI bundle |
| `@fontsource-variable/host-grotesk` | 5.3.0 | OFL-1.1 | UI bundle |
| `@fontsource/atkinson-hyperlegible-mono` | 5.3.0 | OFL-1.1 | UI bundle |
| `@fontsource/instrument-serif` | 5.3.0 | OFL-1.1 | UI bundle |
| `@fontsource/jetbrains-mono` | 5.3.0 | OFL-1.1 | UI bundle |
| `@radix-ui/react-dialog` | 1.3.1 | MIT | UI bundle |
| `@radix-ui/react-slider` | 1.6.1 | MIT | UI bundle |
| `@radix-ui/react-tabs` | 1.2.1 | MIT | UI bundle |
| `@radix-ui/react-tooltip` | 1.4.1 | MIT | UI bundle |
| `@tanstack/react-virtual` | 3.14.26 | MIT | UI bundle |
| `@xyflow/react` | 13.0.2 | MIT | UI bundle |
| `cmdk` | 1.1.1 | MIT | UI bundle |
| `echarts` | 6.1.0 | Apache-2.0 | UI bundle |
| `lucide-react` | 1.76.0 | ISC | UI bundle |
| `motion` | 14.14.0 | MIT | UI bundle |
| `react` | 18.3.1 | MIT | UI bundle |
| `react-dom` | 18.3.1 | MIT | UI bundle |
| `sonner` | 2.0.8 | MIT | UI bundle |
| `@types/react` | 18.3.12 | MIT | UI build tooling |
| `@types/react-dom` | 18.3.1 | MIT | UI build tooling |
| `@vitejs/plugin-react` | 4.3.4 | MIT | UI build tooling |
| `eslint` | 9.15.0 | MIT | UI build tooling |
| `eslint-plugin-react-hooks` | 5.0.0 | MIT | UI build tooling |
| `typescript` | 5.6.3 | Apache-2.0 | UI build tooling |
| `typescript-eslint` | 8.15.0 | MIT | UI build tooling |
| `vite` | 5.4.11 | MIT | UI build tooling |
