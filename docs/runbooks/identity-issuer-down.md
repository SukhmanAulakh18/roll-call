# Runbook: identity issuer down

Scope: the identity issuer, which lives inside the control service in the demo (`services/control/src/identity.ts`), refuses or fails to issue tokens. The issuer is Tier-0 (ADR-005). Treat any issuer incident as high priority.

## Symptoms
- `POST /v1/identity/token` fails with a 5xx or times out.
- Agents log authentication failures on renewal. Gateways reject tokens with an expired `expiresAt`.
- Calls with a valid token still succeed until expiry, then start returning authentication errors (AuthN failures in gateway metrics).
- The fleet summary shows agents moving to `alert` or stopping as their tokens expire.

## Expected behaviour
- Agents keep working until their current token expires. With a 60-second TTL, the gap is at most one TTL after the issuer stops.
- After that, agents cannot authenticate and stop. This is intended. A stolen or old token does not live long.
- No new identities, so no new agents can start and no killed agent can be re-issued.

## Dashboards and commands
- Issuer health through the control service: `curl -s http://localhost:7100/healthz`
- Try a renewal for a known agent (expect a token while the issuer is up):
  ```
  curl -s -X POST http://localhost:7100/v1/identity/token \
    -H 'content-type: application/json' -d '{"agentId":"kyc-refresh"}'
  ```
- Authentication failures on each gateway: `curl -s http://localhost:7200/metrics`
- Chaos drill for the issuer (demo): `make chaos`.

## Steps
1. Decide whether the issuer or the control service is at fault. If the control service is healthy but token renewal fails, the issuer's signing key or configuration is the likely cause. Check the control logs for the cause.
2. Check the signing secret is present and unchanged. Do not rotate the key during an incident unless a compromise is suspected. Rotation invalidates all current tokens at once.
3. Restart the control service if it is wedged: `docker compose -f deploy/compose/docker-compose.yml restart control`.
4. If a compromise of the signing key is suspected, stop: revoke all agents through the owner, rotate the key and follow the security incident process. Do not restart the fleet until the key is rotated.
5. Once the issuer is back, confirm renewals succeed and let agents recover without restarting them.

## Verification
- `POST /v1/identity/token` returns a token and `spiffeId` of the form `spiffe://rollcall.local/agent/<id>`.
- Agents resume: their calls return `OK` again within one token renewal interval.
- A revoked agent is still refused (run the kill check in `kill-and-verify.md` on a test agent).
- Authentication failures in gateway metrics return to baseline.

## Rollback
- If a restart or key change causes a wider failure, restore the previous configuration and restart. Tokens issued before the change expire within one TTL.
- Never disable token checks at the gateway to restore service. That removes the attribution and kill controls.

## Escalation
- Security on-call: immediately if key compromise is possible.
- Platform on-call: for restart and configuration problems.
- Risk owner: if agents were stopped for longer than the agreed business impact window.
