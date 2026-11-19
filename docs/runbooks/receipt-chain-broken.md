# Runbook: receipt chain broken

Scope: `verifyChain` reports a broken chain for one gateway replica. Either a receipt was changed or removed, or the file was damaged (disk full, crash mid-write, a bad copy). Until the cause is known, treat it as possible tampering.

## Symptoms
- `GET /v1/receipts/verify` returns `ok: false` for a replica, with `brokenAt` and `reason`.
- `make verify` fails on the tamper or chain check.
- A gap in `seq` values, or a `prevHash` that does not match the previous record.

## Dashboards and commands
- Chain status for all replicas:
  ```
  curl -s http://localhost:7100/v1/receipts/verify
  ```
- Verify a single chain file directly (offline), from the repository root:
  ```
  node -e "import('./services/gateway/src/receipts.ts').then(m => console.log(m.verifyChain(process.argv[1])))" <dataDir>/receipts/<gatewayId>.jsonl
  ```
- Full verification run, including the tamper test: `make verify`.
- Disk and file state inside compose: `docker compose -f deploy/compose/docker-compose.yml exec gateway-1 ls -la /data/receipts`.

## Steps
1. Do not repair the file. Copy it aside with its checksum before any other action:
   ```
   cp <dataDir>/receipts/<gatewayId>.jsonl <dataDir>/receipts/<gatewayId>.jsonl.evidence-<date>
   sha256sum <dataDir>/receipts/<gatewayId>.jsonl.evidence-<date>
   ```
2. Note `brokenAt` (the first bad `seq`) and `reason`.
3. Check for a benign cause: the gateway may have crashed during a write (the last line is incomplete), or the volume may be full. Check disk space and the gateway logs around the time of the break.
4. If the cause is a crash mid-write, the damage is limited to the last record. Keep the evidence copy, then open a ticket to decide on truncation with the security owner. Do not truncate without that decision.
5. If there is no benign cause, treat it as possible tampering. Escalate to security, freeze the file (make it read-only), and preserve the volume.
6. Check the WORM anchor for the replica (production). In the demo there is no anchor, so say so in the record.

## Verification
- For a benign truncation: `verifyChain` on the evidence copy reports the break at the expected `seq`, and the live file is ok after the agreed action.
- For tampering: the break is recorded in the incident with the evidence checksum. No further writes to the replica's chain without a decision.
- `make verify` runs the tamper test and must still pass on the code.

## Rollback
- There is no rollback for a chain. Keep the evidence copy and the replica's previous file. Do not restore from backup over the live file without security approval.
- If the gateway was restarted with a damaged file, the new records continue from the last good hash only if the chain is intact. Confirm before continuing.

## Escalation
- Security on-call: immediately for any possible tampering. This is the default if you are unsure.
- Audit owner: for any receipt the audit may rely on.
- Platform on-call: for disk, volume or crash causes.
