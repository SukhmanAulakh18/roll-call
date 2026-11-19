# Architecture Decision Records

Each ADR records one decision: the context, the options considered, what was decided and what follows from it. Statuses: Accepted (spike or design), Superseded (link to the replacement).

| ADR | Title | Status |
|---|---|---|
| [001](ADR-001-gateway.md) | Gateway: data plane between agents and tools/LLMs | Accepted (spike) |
| [002](ADR-002-policy-engine.md) | Policy engine | Accepted (spike) |
| [003](ADR-003-agents-as-crds.md) | Agents as CRDs, with AgentRecord separate from the runtime | Accepted (design) |
| [004](ADR-004-control-data-plane-split.md) | Control plane and data plane split, with static stability | Accepted (design) |
| [005](ADR-005-identity.md) | Agent identity with short-lived tokens | Accepted (demo; SPIRE in production) |
| [006](ADR-006-kill-with-proof.md) | Kill means revoke, stop, and prove | Accepted (design) |
| [007](ADR-007-deterministic-detectors.md) | Deterministic detectors, two-signal rule, no model in the loop | Accepted (design) |
| [008](ADR-008-receipts.md) | Hash-chained receipts per replica, anchored to WORM storage | Accepted (demo; WORM in production) |
| [009](ADR-009-otel-adapter.md) | OpenTelemetry adapter layer | Accepted (design) |
| [010](ADR-010-compose-then-kind.md) | Compose first, then kind | Accepted (design) |
| [011](ADR-011-simulated-fleet-real-controls.md) | Simulated fleet with real controls, and Replay | Accepted (design) |
| [012](ADR-012-open-licenses-valkey-opentofu.md) | Valkey over Redis, OpenTofu over Terraform | Accepted (design; verify licences) |
| [013](ADR-013-admission.md) | Two-layer Kubernetes admission | Accepted |
| [014](ADR-014-promotion-gates.md) | Promotion gates and automatic rollback | Accepted (demo; Argo Rollouts is design only) |

To add an ADR, copy the structure of an existing one, take the next number and add a row here.
