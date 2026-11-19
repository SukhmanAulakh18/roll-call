# Runbook: control plane down

Scope: the control service (port 7100 in compose) is unreachable or returning errors. Gateways should keep serving on their cached policy bundle (ADR-004). This runbook covers what still works, what stops, and how to recover.

## Symptoms
- `GET /healthz` on the control service fails or times out.
- The UI and the control stream (`/v1/stream`) disconnect.
- Gateways log bundle refresh failures. Gateway `/healthz` still passes.
- Gateway metrics show the bundle age growing toward `staleAfterMs`.

## Expected behaviour while control is down
- Low-risk tool calls continue on the cached bundle.
- Once the bundle is older than `staleAfterMs`, calls to `highRiskTools` are denied with `STALE_POLICY_HIGH_RISK`.
- No new identities are issued and no new admissions are granted.
- Kill and revocation cannot be pushed. A revocation already in the cached bundle still applies.
- Running agents keep working until their current token expires (60-second TTL, ADR-005).

## Dashboards and commands
- Control health: `curl -s http://localhost:7100/healthz`
- Gateway health, each replica: `curl -s http://localhost:7200/healthz` and `curl -s http://localhost:7201/healthz`
- Bundle a gateway holds, through the gateway's logs and metrics: `curl -s http://localhost:7200/metrics`
- Compose status and logs: `docker compose -f deploy/compose/docker-compose.yml ps` and `... logs --tail=200 control`
- Reproduce the failure and the static-stability behaviour: `make chaos` (control-plane stop game day, results in impact.json).

## Steps
1. Confirm the outage is the control service and not the network: check the control container status and logs.
2. Post in the incident channel that the data plane is serving on cached policy, and that high-risk tools will fail closed after the bundle ages out.
3. If an agent must be killed during the outage, the kill cannot complete. Block the agent at the network or runtime level by scaling its runtime to zero, then record that the revocation has not reached the gateways. Revoke when control returns.
4. Do not register or change agents while control is down. Admissions are not possible anyway.
5. Restart the control service: `docker compose -f deploy/compose/docker-compose.yml restart control`, or `make stack` locally.
6. Wait for the gateways to pull a fresh bundle. Check the bundle version on the control side with `curl -s http://localhost:7100/v1/bundle`.

## Verification
- `GET /healthz` on control returns OK.
- `GET /v1/bundle` returns a bundle with a new `issuedAt`.
- High-risk calls that were denied with `STALE_POLICY_HIGH_RISK` now return `OK` when tested with a known good agent.
- `GET /v1/receipts/verify` returns `ok: true`. Calls made during the outage are in the chain.
- Any kill requested during the outage is re-issued and reaches `proof`.

## Rollback
- If the restarted control service is serving a bad bundle, follow `bad-policy-bundle.md`.
- Do not run the control service against an older data directory unless the data-loss decision has been made. Note that the revocation list lives in control.

## Escalation
- Platform on-call: immediately if control does not return after a restart.
- Owner of the identity issuer: if the control outage is caused by the issuer. See `identity-issuer-down.md`.
- Risk owner: if high-risk tools were denied for longer than the agreed business impact window.
