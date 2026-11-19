# Runbook: kill and verify

Scope: stopping one agent and proving that it cannot act. Use for confirmed runaways, compromised agents or owner request.

## Symptoms
- A runaway that the owner has confirmed is wrong (see `runaway-agent.md`).
- A suspected compromise: an agent calling tools outside its scopes, or a token used from an unexpected place.
- An owner or risk officer asks for an agent to be stopped.

## Dashboards and commands
- Find the agent and its current state:
  ```
  curl -s http://localhost:7100/v1/agents/<agentId>
  ```
- Check the recent incident timeline:
  ```
  curl -s http://localhost:7100/v1/incidents
  ```
- Kill (revoke, stop the runtime, run the independent probe):
  ```
  curl -s -X POST http://localhost:7100/v1/agents/<agentId>/kill \
    -H 'content-type: application/json' -d '{"reason":"<short reason, ticket id>"}'
  ```
  The response is an `IncidentEvent`. When it is a kill, `stage` must be `proof` and `proof.verdict` must be `deny`, with `proof.code` = `REVOKED`.
- Confirm no new identity can be issued:
  ```
  curl -s -X POST http://localhost:7100/v1/identity/token \
    -H 'content-type: application/json' -d '{"agentId":"<agentId>"}'
  ```
  Expect a refusal, not a token.
- Verify the receipt chain for the replicas that handled the agent's calls:
  ```
  curl -s http://localhost:7100/v1/receipts/verify
  ```
- Reproduce the kill path in the demo: `make drill` (governed runs include kill and proof timings in impact.json).

## Steps
1. Record the ticket id and the reason. The kill request body carries it.
2. Run the kill request above.
3. Read the response. If `stage` is `proof` and the probe was denied with `REVOKED`, go to Verification.
4. If `stage` is `killed` but not `proof`, the probe did not complete. Wait briefly and read `GET /v1/incidents` again. If it is still not at `proof`, go to Rollback and Escalation.
5. Tell the owner the agent is killed and give them the incident id.

## Verification
- The incident includes a `proof` stage with `attemptedTool`, `verdict: deny`, `code: REVOKED` and a `receiptId`.
- The identity refusal above returns an error, not a token.
- The runtime has stopped. In compose this is the simulated process; in kind, the Deployment or Agent is at zero replicas.
- The `receiptId` of the proof is present in the chain (`GET /v1/receipts/verify` for its replica is `ok: true`).

## Rollback
- A kill is not reversed by an operator. To return the agent to service, the owner approves, the record is revised, and the agent is registered again as a new workload. Admission must pass before it runs (`admit` rules: owner, scopes, evaluation for production).
- If the kill was wrong, record that on the incident and in the postmortem. Do not hand-edit the revocation list.

## Escalation
- Security on-call: immediately for any suspected compromise.
- Platform on-call: if the probe is not denied, or the identity refusal fails. The control plane may be in an unexpected state. See `control-plane-down.md`.
- Owner: after every kill, with the incident id.
