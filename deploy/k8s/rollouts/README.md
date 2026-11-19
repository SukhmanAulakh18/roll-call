# Argo Rollouts: manifests for the production design; not exercised in this repo's cluster

These files show how a Kubernetes agent deployment would use Roll Call's promotion gate (ADR-014) for canary delivery. **They have not been applied to any cluster, including the kind or apiserver setup in this repository.** `kubeconform`-style schema checks have not been run either. Treat them as a reviewed design.

What is real and tested in this repo: the gate itself (`services/control/src/lifecycle.ts`), `POST /v1/agents/:id/promote?dryRun=1`, and the simulated canary controller with auto-rollback (`make drill-release`).

## Files
- `rollout.yaml`: a `Rollout` for `invoice-recon` with 20%, 50% canary steps. After each step it runs the analysis below. A failed analysis aborts and returns traffic to the stable ReplicaSet (auto-rollback).
- `analysis-template.yaml`: an `AnalysisTemplate` with two metrics. `rollcall-gate` is a `web` provider calling Roll Call `POST /v1/agents/{agent}/promote?dryRun=1&to=production` and succeeding only when the JSON answer has `allowed == true` (HTTP 409 also fails the metric). `slo-error-ratio` is an optional Prometheus query against the gateway's `/metrics` decision counters.

## Assumptions to check before using
- Control is reachable at `http://rollcall-control.rollcall-system.svc:7100` from the analysis pods (the in-kind control service is TLS-fronted for the webhook only).
- Canary pods run as a separate identity (`<agent>@<version>`), so the gateway's per-agent decision counters separate the two versions. In the simulation the control plane arranges this; in Kubernetes the workload must request that identity.
- The Prometheus query uses `rollcall_gateway_decisions_total{gateway,verdict,code}`, which the gateway exports today with no agent label. A per-agent label would have to be added before that metric can judge one canary.
- The gate's drill and attack-suite evidence comes from the control plane's `impact.json`; in production it would come from the CI drill job.
- While a canary of the agent is running, the gate judges it as a canary even if the record is already `production` (`releases.promote`). Without a running canary, `to=production` on a production agent is blocked ("production cannot move to production").
- Not verified against Argo: the exact `jsonPath` and `successCondition` typing of a boolean, and that a 409 answer counts as a failed measurement (Argo treats a non-2xx web answer as an error, which fails the analysis after `consecutiveErrorLimit`).
