# ADR-005: Agent identity with short-lived tokens

Status: Accepted (demo), production design uses SPIRE

## Context
Every agent call must carry an identity the gateway can check, so that calls are attributed, scopes are enforced and a kill can take effect. Long-lived API keys are hard to revoke quickly and hard to attribute. The identity has to work offline in the demo and map onto the production design without changing the gateway.

## Options
1. Static API keys per agent. Easy, but revocation depends on every holder honouring it, and keys live long.
2. Short-lived HMAC-signed tokens issued by a Roll Call identity issuer, with SPIFFE-style subjects `spiffe://rollcall.local/agent/<id>` and a TTL of 60 seconds.
3. Full SPIRE deployment from day one (workload attestation through the Kubernetes API).

## Decision
Option 2 for the demo, with option 3 as the production design. The issuer (`issueToken(agentId, ttlMs)` and `verifyToken(token)` in `services/control/src/identity.ts`) signs tokens with HMAC and a 60-second TTL. The gateway verifies each token and checks the revocation list from the bundle. The subject format is chosen so that SPIRE SVIDs can replace the tokens without changing the subject names that policy uses.

Trade-off, stated plainly:
- A shorter TTL means a kill takes effect sooner, because a revoked identity cannot renew, and the old token expires within one TTL at most.
- A shorter TTL also means the agent depends more on the issuer, because it must renew more often. An issuer outage stops renewals within one TTL.
- The issuer is Tier-0. Compromise of its signing key allows any agent identity to be minted, so its key handling, access and logging are controlled like a certificate authority.

## Consequences
- Revocation has two parts: the bundle revocation list in the gateway, and the issuer refusing renewals. The kill runbook checks both.
- Issuer outage behaviour is defined in the identity-issuer-down runbook (agents keep working until their token expires, then stop).
- The HMAC key is a single secret in the demo. Production must move to asymmetric keys held by SPIRE or a KMS.
- Tokens are never written to receipts or events. Only the agent id, the tool and a hash of the arguments are recorded.

## Evidence
Design plus the demo implementation in `services/control/src/identity.ts`. Token expiry and renewal timings: see impact.json (`make chaos`).
