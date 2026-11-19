# ADR-004: Control plane and data plane split, with static stability

Status: Accepted (design)

## Context
The control plane holds the registry, the identity issuer, policy, incidents, admission and drills. The data plane is the set of gateway replicas that every agent call passes through. If every gateway had to ask the control plane for every decision, a control-plane outage would stop all agents, and a bank would rather have a controlled degradation than a total outage. The opposite failure is also a risk: a gateway that keeps running on an old policy forever could let a revoked or out-of-scope action through.

## Options
1. Synchronous decisions. Every call asks control. Simple to reason about, but control is in the critical path and an outage stops the fleet.
2. Fully cached. Gateways run on whatever policy they last received, indefinitely. Survives outages, but a stale policy is never noticed.
3. Static stability with a bounded staleness window. Gateways act on a cached, signed policy bundle. Low-risk calls continue. After `staleAfterMs` without a fresh bundle, high-risk tools fail closed. Control outages also block new admissions and new identities.

## Decision
Option 3. The gateway pulls `GET /v1/bundle` and keeps the last good copy. The bundle carries `staleAfterMs` and `highRiskTools`.
- While control is down and the bundle is fresh, all calls continue on the cached bundle.
- Once the bundle is older than `staleAfterMs`, calls to tools in `highRiskTools` return `STALE_POLICY_HIGH_RISK` and are denied. Other tools continue.
- While control is down, no new identities are issued (`POST /v1/identity/token` is unavailable) and no new admissions are granted. Running agents keep working until their identity token expires (ADR-005).
- Kill and revocation need control. A revocation already in the cached bundle still applies. A revocation that has not reached the gateway cannot be pushed while control is down. This is an accepted limit and is shown in the control-plane-down runbook.

## Consequences
- The fleet degrades in a known way instead of failing outright, and the rules are testable (the static-stability acceptance test checks this).
- Operators need to understand two clocks: bundle staleness and token expiry. Both are shown on the dashboard.
- Fail-closed for high-risk tools is a deliberate availability cost. Owners of high-risk tools should know this before a control-plane maintenance window.
- The bundle signature and the gateway's trust in it become part of the security boundary.

## Evidence
Design. The behaviour is checked by the static-stability test in `tests/acceptance/dod.test.ts` and by the `make chaos` control-plane-stop game day. Measured recovery figures: see impact.json (`make chaos`).
