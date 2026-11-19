# ADR-014: Promotion gates and automatic rollback

Status: Accepted (demo in the simulated fleet; Argo Rollouts wiring is a production design, not exercised here)

## Context
Lifecycle states (draft, shadow, canary, production, retired) were labels that anyone with write access could set. Admission only checked that canary and production records carried a passing evaluation flag. A new version of a live agent replaced the old one in place, with nothing watching the first minutes. The brief asks for states that advance only with evidence, no production without evaluation evidence, continuous delivery as a canary with analysis gates, an error-budget policy, and an auto-rollback we can demonstrate.

## Options
1. Keep manual approval only. Cheap, but the approval is a flag flip and a bad version is found by users.
2. Gates in the CD tool only (for example Argo Rollouts analysis). Good for rollout mechanics, but the evidence (evaluation, drills, attack suite) lives in Roll Call, and a second implementation of the rules would drift.
3. One pure gate function in Roll Call, called by the control plane's own canary controller and, in production, by the CD tool. Chosen.

## Decision
`evaluatePromotion(record, evidence)` in `services/control/src/lifecycle.ts` is pure: the same record and evidence always give the same verdict. It returns `{allowed, reason, checks[]}`; `reason` is plain English and each check says what it measured.

Gates by target state (all numbers are the `POLICY` constants in `lifecycle.ts`):

| To | Gates |
|---|---|
| shadow | record complete (owner, escalation, scopes) |
| canary | evaluation evidence: on file, with an evidence URL, passed, not older than 365 days |
| production | evaluation evidence; drill regression (every runaway drill contained, p95 within the containment budget, read from `impact.json`); attack suite (zero attacks escaped hard containment, from the detector section of `impact.json`); canary analysis |
| retired | none. Any live state can retire; the record is kept, the identity is refused and the runtime is stopped. |

Every forward promotion also needs the error budget not exhausted. States move one step at a time; there is no demotion except by retiring.

Canary analysis compares the new version with the stable one over the same window, from gateway events. Needs at least 8 canary decisions. Passes when the canary error rate is at most the stable rate plus 5 points, and the canary p99 is at most 1.5 times the stable p99 plus 10 ms. An error is any decision that is not `allow`. The latency is the gateway decision-path time recorded in each event, so the slack absorbs timer noise.

Error budget, defined simply: objective 99% of an agent's decisions are `allow`, measured over the decisions control holds for the stable version (up to its 100,000-event ledger; in the simulation, since the last reset). If more than 1% were denied, throttled or failed, the budget is exhausted and promotions are frozen. Fewer than 20 decisions: no verdict, not exhausted. A runaway agent that was throttled therefore freezes its own promotions.

Release controller (`services/control/src/releases.ts`). A version bump (`POST /v1/agents/:id/releases`) runs the new version under its own identity, `<agent>@<version>`, taking half of the agent's traffic. The identity is added to the policy bundle only while the canary runs. On each control tick the gate function is applied to measured events: a failing canary is rolled back as soon as enough decisions are in (canary stopped, identity gone from the bundle, traffic back on stable, record stays at the stable version); a passing one is promoted after the canary window (record version updated). Incident stages: `canary_started`, `detected` (analysis failed), `rolled_back` or `promoted`.

HTTP: `POST /v1/agents/:id/promote {to}`, with `?dryRun=1` to evaluate without changing anything. 200 allowed, 409 blocked; both carry the checks.

## Consequences
- The rules exist once. The UI Promote button, the control plane's canary controller and Argo Rollouts (`deploy/k8s/rollouts/`) all call the same function.
- Verdicts are deterministic given evidence, but evidence is measured, so a drill's timings vary run to run. `make drill-release` reports the measured count of automatic rollbacks, time to rollback and false rollbacks on good releases.
- Limits. The drill injects one fault kind (failing requests); latency and out-of-scope regressions are covered by the gate and unit tests but not drilled. The simulated canary gets 1 call per second, which is why 8 decisions take about 8 seconds. Evidence from `impact.json` is only as fresh as the last `make drill`. The error budget is computed from a bounded in-memory ledger, not a long-term store. Thresholds are policy choices, not tuned to pass.
- Argo Rollouts manifests are a design for production and have not been run in this repository's cluster.
