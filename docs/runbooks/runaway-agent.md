# Runbook: runaway agent

Scope: an agent is repeating calls, calling another agent in a cycle, or spending faster than its own baseline. Applies to both the demo fleet and real agents once wired in.

## Symptoms
- Incident on the control stream with stage `detected`, then `throttled` or `paged`.
- Spend per minute for one agent far above its own baseline (fleet summary, `spendPerMinUsd`).
- Gateway verdicts for one agent switching to `THROTTLED` (HTTP 429) or `BUDGET_EXCEEDED` (HTTP 403).
- Repeated `(tool, argsHash)` pairs in the action stream, or an A2A cycle in `targetAgentId`.

## Dashboards and commands
- UI: `make demo`, then http://localhost:7100. The incident timeline shows each stage with the signal values.
- Open incidents and their stages:
  ```
  curl -s http://localhost:7100/v1/incidents
  ```
- Agent state:
  ```
  curl -s http://localhost:7100/v1/agents/<agentId>
  ```
- Live stream (action, incident and fleet messages):
  ```
  curl -N http://localhost:7100/v1/stream
  ```
- Gateway metrics for each replica: `GET http://localhost:7200/metrics` and `GET http://localhost:7201/metrics`.
- Reproduce the detector behaviour offline: `make drill`.

## Steps
1. Confirm it is an agent loop and not a traffic spike. Check the incident `signals`: a rate ratio with a repeat count or cycle is a runaway. A rate ratio alone is a soft signal.
2. If the incident is `detected` or `throttled` only (one signal), leave the soft throttle in place. Watch until the signal clears or the owner responds.
3. If the incident is `paged` (two signals), the owner's escalation target has been notified. Contact the owner (`owner.escalation` on the record). Ask whether the behaviour is expected.
4. If the owner confirms the behaviour is wrong, or the owner cannot be reached and spend is still rising, kill the agent. Follow `kill-and-verify.md`.
5. If the owner confirms the behaviour is expected (for example, a batch job), record the decision on the incident. Raise the agent's throttle or budget through a reviewed change to its record. Do not edit the bundle by hand.
6. Keep the incident open until the owner has decided.

## Verification
- The incident reaches `resolved` (after a kill, `proof` must be present first).
- Spend per minute for the agent returns to its baseline, or the agent is `killed`.
- `GET /v1/receipts/verify` returns `ok: true` for every replica. A runaway should not break the chain.
- `make drill` still reports the detector set as expected if thresholds were changed.

## Rollback
- A throttle is undone by the detector once the signal clears. To remove one manually, restore the agent's record and let the next bundle carry the change. Do not clear throttles by restarting gateways.
- A kill cannot be undone. Re-register the agent as a new workload after the owner signs off, with a new revision of its record.

## Escalation
- Owner (`owner.escalation` on the record): first contact for any `paged` incident.
- Platform on-call: if the detector is firing on many agents at once, treat it as a platform fault (clock skew, a bad threshold change) and see `bad-policy-bundle.md`.
- Security on-call: if the agent attempted out-of-scope tools (`scopeDrift` signal) or a `payments.*` tool during the runaway.
