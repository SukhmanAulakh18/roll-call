# SLOs, burn-rate alerts and the error-budget policy

Targets below are targets. Measured values come from `impact.json` (`make bench`, `make k6`) or from the running Prometheus. The `make k6` figures (`bench.k6`) were taken with incident detection off (`RC_TICK_MS=0`), over loopback with no TLS, on the same machine as the stack; they are not production latency.

## The five SLOs (source of truth: `slo/*.yaml`, OpenSLO v1)

| SLO | Objective (30 d rolling) | SLI (Prometheus) |
|---|---|---|
| `gateway-availability` | 99.95% | decisions not answered `502 TOOL_ERROR` / all decisions. Deny and throttle are correct answers. A dead gateway emits nothing, so `GatewayDown` (`up == 0`) covers it. |
| `decision-latency-p99` | p99 <= 50 ms, i.e. 99% of decisions <= 50 ms | `decision_seconds_bucket{le="0.05"}` / `_count`. Tool time excluded. |
| `time-to-contain-p95` | p95 <= 30 s, i.e. 95% of incidents proven within 30 s | `time_to_contain_seconds_bucket{le="30"}` / `_count`. Detection to independent proof, so it includes the simulated owner ack (ADR-006). Low volume: alerts only evaluate while incidents occur. |
| `unregistered-agents` | zero running | share of 5-minute samples with `unregistered_running == 0`, target 99.9%. Zero is the real rule: `UnregisteredAgentRunning` pages on any sample above 0 for 1 m. The 0.1% only gives the burn maths a budget. |
| `receipt-completeness` | 100% | `receipts_total` / `decision_seconds_count`. Target 99.999% for the same reason; `ReceiptGap` pages on any gap for 5 m. |

`make slo` generates `deploy/observability/prometheus/rules/slo.rules.yml` (do not hand-edit) with, per SLO: error-ratio recordings for 5m, 30m, 1h, 6h, 3d, 30d; `slo:burn_rate:<window>`; `slo:error_budget_remaining:ratio`; and these alerts (both windows must exceed the multiple):

| Severity | Burn rate | Long / short window | Meaning |
|---|---|---|---|
| page | 14.4x | 1h / 5m | 2% of the 30 d budget gone in an hour |
| ticket | 6x | 6h / 30m | 5% gone in 6 hours |
| review | 1x | 3d / 6h | spending exactly as fast as the budget allows |

`make slo-test` runs `promtool check rules` and `promtool test rules` (`deploy/observability/prometheus/tests/slo.test.yml`: synthetic 10% errors fire the page and ticket alerts, healthy traffic fires nothing, an unregistered agent pages). `invariants.rules.yml` is hand-written: `GatewayDown`, `UnregisteredAgentRunning`, `ReceiptGap`.

## Error-budget policy

Policy only: nothing reads these Prometheus SLOs to freeze anything yet. Separately, the promotion gate in `services/control/src/lifecycle.ts` enforces a simpler per-agent error budget (99% of decisions allowed, from an in-memory ledger; ADR-014). That gate is real code, but it is not driven by the SLOs on this page.

1. The signal is `slo:error_budget_remaining:ratio{slo=...}`: 1 untouched, 0 exhausted, below 0 overspent (30 d rolling).
2. Any SLO at or below 0 **freezes promotions**: no agent moves shadow to canary or canary to production, and no gateway or policy-engine release ships, except changes whose only purpose is to restore that SLO. Kill, revoke and rollback are never frozen.
3. Below 0.25 the owning team lists the budget in its weekly review before starting risky work.
4. A `page` burn alert gets an owner immediately; `ticket` within the working day; `review` at the next weekly review.
5. The freeze lifts when remaining budget is above 0 again, or by a recorded decision from the service owner that names the SLO and the reason.
6. Next step for the promotion-gate work: a `/v1/slo/budget` endpoint on control that reads this recording rule from Prometheus and returns `{slo, remaining, frozen}` per SLO. The gate calls it; if Prometheus is unreachable the gate must fail closed for production promotion.

## Running it

`make observe` (compose profile `observability`): Prometheus on :9090 scrapes control and both gateways every 5 s and loads the rules; Grafana on :3000 has the provisioned dashboard "Roll Call — SLOs" (anonymous viewer, admin/admin, lab only). Plain `make compose-up` does not start them. Screenshot of a lab run against the simulated fleet: `docs/img/grafana-slo.png`.

## Metrics added

Gateway: `rollcall_gateway_receipts_total`, `rollcall_gateway_agent_decisions_total{agent,verdict}` (agent is the authenticated id or `unauthenticated`, so callers cannot create series), decision histogram now 10 us to 100 ms with a bucket edge at 50 ms. Control `/metrics`: `rollcall_control_incident_events_total{stage}`, `rollcall_control_time_to_contain_seconds`, `rollcall_control_unregistered_running`, `rollcall_control_agents_registered`/`_running`, `rollcall_control_bundle_version`, `rollcall_control_gateway_bundle_lag_versions`, `rollcall_control_gateway_last_poll_age_seconds`. Gateway `rollcall_gateway_bundle_age_ms` predates this work and keeps its millisecond name.

## Licences

Prometheus and the OTel collector are Apache-2.0. **Grafana OSS and k6 are AGPL-3.0.** Both run unmodified as separate containers (compose, `docker run`) and are not linked into or shipped with Roll Call. If we ever modify or redistribute them, the AGPL obligations apply; see ADR-012.

## Known limits

- Rate-based availability can miss the first increment of a counter series that appears mid-window (a first-ever `TOOL_ERROR`); negligible at volume.
- Prometheus keeps 35 d here; the lab volume is deleted by `make compose-down`, so the 30 d budget only means something on a long-running deployment.
- `make observe-otel` adds a collector that scrapes the same targets and remote-writes with `via="otel"`. It proves the OTel path works but doubles every series, so use it for verification, not alongside the dashboard. Metrics only; traces and logs are ADR-009 next steps.
