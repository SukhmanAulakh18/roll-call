# ADR-006: Kill means revoke, stop, and prove

Status: Accepted (design)

## Context
Owners and the control loop need to stop a misbehaving agent. A kill that only sets a flag is easy to get wrong. The agent might keep a token, its runtime might keep running, or the gateway might not see the change. A bank also needs evidence that the kill worked, not only a log line saying it did.

## Options
1. Revoke the identity only. Simple, but the runtime keeps retrying and the agent's process stays alive.
2. Stop the runtime only. The process is gone, but a token already held elsewhere may still be valid until it expires.
3. Revoke, stop, then verify independently. The kill runs three steps, and a separate probe replays the agent's last attempted action and must see it denied.

## Decision
Option 3. `POST /v1/agents/:id/kill` does the following in order:
1. Revoke the identity: the agent id goes into the revocation list, the issuer refuses renewals, and the revocation is pushed to gateways.
2. Stop the runtime by scaling it to zero (Deployment or kagent `Agent`) or by deleting the sandbox. In the demo, the simulated process is stopped.
3. Run an independent probe. The probe is a separate client, not the killed agent, that replays the last action the agent attempted and must receive a deny with code `REVOKED`. The result is written as a `proof` stage in the incident, with the probe's receipt id.

The incident is only resolved when the proof stage is present. If the probe is not denied, the incident stays open and pages a human.

## Consequences
- Kill is slower than a flag flip because it has three steps. The contain-time target in `docs/latency-budget.md` sets the limit, and measured times come from `make drill`.
- The proof depends on the gateway seeing the revocation. If the gateway is partitioned, the probe can fail for a reason unrelated to the agent. That case is handled in the control-plane-down runbook.
- Kill needs the control plane. This is the one control action that cannot run from a cache (see ADR-004).
- Proof is evidence for audit, so the probe's receipt joins the receipt chain (ADR-008).

## Evidence
Design. The demo implements kill and probe in the control service and the acceptance test checks that a revoked agent gets `REVOKED` and cannot obtain a new identity. Timings: see impact.json (`make drill`).
