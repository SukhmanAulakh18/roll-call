# Runbook: bad policy bundle

Scope: the policy bundle served by `GET /v1/bundle` is wrong. Examples: a scope was widened by mistake, a budget is zero for a working agent, a high-risk tool is missing from `highRiskTools`, a throttle is too strict, or a price is wrong.

## Symptoms
- Many agents suddenly denied with `OUT_OF_SCOPE`, `BUDGET_EXCEEDED` or `THROTTLED`, with no runaway signal.
- Agents allowed to call tools they should not (`scopeDrift` findings with no matching owner change).
- Bundle `version` changed, and `issuedAt` is new, shortly before the symptoms.
- Spend numbers in the fleet summary that do not match the price table.

## Dashboards and commands
- Current bundle: `curl -s http://localhost:7100/v1/bundle`. Note `version`, `issuedAt`, `highRiskTools`, `staleAfterMs`.
- Agent record behind a bundle entry: `curl -s http://localhost:7100/v1/agents/<agentId>`.
- Incidents and findings: `curl -s http://localhost:7100/v1/incidents`.
- Gateway verdict codes: `curl -s http://localhost:7200/metrics` (look for the code labels).
- Reproduce the detector and drill set on the known-good policy: `make drill`.

## Steps
1. Stop the change from spreading. Do not publish any new bundle until the fault is understood.
2. Compare the current bundle with the last known good version. Use the record history from version control: the seed file used by control, or the record revision that was last reviewed.
3. Identify the change. Common causes: a record edited without review, a scope list typed wrong, `staleAfterMs` set too low, or a price table changed.
4. Restore the last good record or seed file and restart the control service so it rebuilds the bundle:
   ```
   docker compose -f deploy/compose/docker-compose.yml restart control
   ```
   Or `make stack` locally.
5. Confirm the new bundle has the expected `version` and content.
6. If scopes were widened and any agent used a tool it should not have, treat it as a security incident. Pull its receipts and check the chain (`GET /v1/receipts/verify`).

## Verification
- `GET /v1/bundle` shows the restored content and a new `issuedAt`.
- Agents that were denied with the bad codes return `OK` for allowed calls.
- Out-of-scope calls made during the bad period are visible in receipts and listed in the postmortem.
- `make drill` shows the expected detector results.

## Rollback
- Rollback is the restore in step 4. It is itself a bundle change, so record who made it and why.
- Keep the bad bundle version and its record diff for the postmortem.

## Escalation
- Platform on-call: for the restore.
- Owner of the affected agents: for any scope or budget decision.
- Security on-call: if out-of-scope tools were used.
- Model risk and governance owner: for any change to risk ratings, `highRiskTools` or budgets, which need review before they are reapplied.
