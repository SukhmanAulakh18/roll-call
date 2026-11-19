# ADR-008: Hash-chained receipts per gateway replica, anchored to WORM storage in production

Status: Accepted (demo), production design uses WORM object storage

## Context
Roll Call makes a claim about what it did: every governed action was checked and recorded, and the record was not changed afterwards. That claim is only worth something if it can be checked. The record also has to survive a gateway crash, and gateway replicas must not need to coordinate on every write.

## Options
1. A central append-only database written by every gateway. Simple to query, but it adds a write dependency on the data path and makes replicas share a write point.
2. Per-replica hash chains in JSONL, with each receipt containing the hash of the previous one.
3. Per-replica hash chains plus anchoring: chain heads are shipped to write-once object storage (object lock) on a schedule.

## Decision
Option 2 now and option 3 for production. Each gateway replica writes `<dataDir>/receipts/<gatewayId>.jsonl`. Each receipt has `seq`, `prevHash` (`GENESIS` for seq 0) and `hash = sha256(prevHash + canonicalJSON(receipt without hash))`. `verifyChain(file)` recomputes every hash and reports the first broken sequence number. `GET /v1/receipts/verify` runs this per replica. The receipt does not store arguments, only `argsHash`.

Production adds the anchor. The chain head of each replica is written to WORM storage at a fixed interval, so a replica's history cannot be rewritten without contradicting an earlier anchor.

## Consequences
- The data path writes locally and does not depend on a central database for each call.
- Replicas cannot be merged into one ordering. Cross-replica order is by timestamp, which is not proof of order. This is stated, not hidden.
- Deleting the tail of a chain is not detected by the chain alone. The WORM anchor detects it. Until anchoring exists, the demo cannot claim tail-truncation protection.
- Arguments are hashed, so a receipt proves what was asked without storing sensitive payloads. The original payload stays in the source system.
- Tamper detection is tested: the acceptance test changes one field and checks that `brokenAt` points at that record (`make verify`).
