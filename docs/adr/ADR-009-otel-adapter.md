# ADR-009: An OpenTelemetry adapter layer, because the GenAI conventions are still in Development

Status: Accepted (design)

## Context
Roll Call needs telemetry for agents: calls, tokens, cost, latency and decisions. The OpenTelemetry GenAI semantic conventions define names for this, but at the last check they were still marked "Development" status, which means names and attributes can change. Hard-wiring our own attribute names to a moving convention would mean re-instrumenting later.

## Options
1. Adopt the GenAI conventions directly everywhere, accepting that names may change.
2. Define Roll Call's own internal event schema (`ActionEvent`, `Receipt`) and map it to OpenTelemetry in one adapter layer.
3. Use a vendor-specific SDK and skip OpenTelemetry.

## Decision
Option 2. Internal events use the Roll Call contract in `contracts/types.ts`. A single adapter layer maps them to OpenTelemetry spans, metrics and logs. Where a GenAI convention exists and is stable enough, the adapter uses it. Where it is still in Development, the adapter isolates the choice, so a rename changes one file. Pinned attribute names are listed in the adapter, and the version is recorded in the architecture notes.

## Consequences
- Telemetry names are ours to keep stable for dashboards and runbooks, independent of upstream renames.
- One more layer to maintain. It is small and tested by mapping fixtures.
- The production path is OTel Collector to Prometheus (metrics), Tempo (traces) and Loki (logs), with Grafana on top, plus Langfuse for LLM-specific traces. See `docs/architecture.md`.
- Re-check the GenAI convention status before each release. If it reaches Stable, the adapter can be simplified.
- Offline demo: the gateway and control expose Prometheus text at `GET /metrics`, which needs no collector. Prometheus scrape is the primary path (`make observe`).
- Built: `deploy/observability/otel-collector.yaml` (compose profile `otel`) scrapes the same targets and remote-writes to Prometheus. Verified once, metrics only. Not built: the adapter that maps events to spans and logs, Tempo, Loki, Langfuse.
