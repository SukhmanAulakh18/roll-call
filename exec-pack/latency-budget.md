# Latency budget

This page holds targets and the method. It does not hold measured values. Measured numbers come from the benches and drills and are read from `impact.json`:
- Decision path latency and overhead against the ungoverned baseline: `make bench`. See impact.json (`make bench`).
- Control loop timings and containment: `make drill`. See impact.json (`make drill`).

Every number in the tables below is a target from the design. A target is a limit we aim to meet and check against; it is not a result.

## Decision path budget (per governed call)

The decision path is the work the gateway does before and after the tool call itself. The tool's own time is excluded, as in `ActResponse.latencyMs`.

| Stage | Target (ms) |
|---|---|
| Ingress and TLS | 2 |
| AuthN (token check) | 3 |
| Budget check | 3 |
| Policy evaluation | 5 |
| Masking | 3 |
| Receipt write | 8 |
| Overhead (routing, serialisation, bookkeeping) | 4 |
| **Sum of stage targets** | **28** |
| Headroom | 22 |
| **Target p99 for the decision path** | **≤ 50** |

The sum of stage targets is 28. The headroom of 22 is the difference to the p99 target of 50. Headroom absorbs queueing and tail effects that the stage targets do not capture.

Actual p50, p95, p99 and overhead against the ungoverned baseline: see impact.json (`make bench`).

## Control loop budget

The control loop is the time from fault to containment. Each row is a target for the time to reach the named stage from the fault start (t0). The containment target is a p95 over at least 20 drills.

| Step | Target |
|---|---|
| Detect (fault to `detected`) | ≤ 10 s |
| Throttle (`detected` to `throttled`) | ≤ 5 s |
| Page (`throttled` or `detected` to `paged`) | ≤ 5 s |
| Kill and proof (`paged` to `proof`) | ≤ 10 s |
| Contain (t0 to `proof`, p95 over ≥ 20 drills) | ≤ 30 s |

Actuals: see impact.json (`make drill`). Compare the `stages` and `timeToContainMs` fields of each DrillResult against the table above.

## How the budgets are checked
- Each target has an entry in impact.json or a named test. A target without a measured entry is reported as "not measured", not as passing.
- The bench and the drill run on the same laptop used for the demo. Results from other hardware are not comparable and must be labelled.
- A change that moves a stage target needs an updated budget and a new bench run.
- Production numbers will differ. They are set when the Kubernetes deployment has its own measurements.
