# Cost model

Numbers are from the last recorded run: impact.json generatedAt 2026-11-19T15:34:34.489Z, gitSha eebcee1 (chaos section run at 2026-11-19T08:45:37.109Z). generatedAt is the time of the latest merge into impact.json; sections run earlier keep their own measurements.

**ASSUMPTION.** Every price below is an illustrative assumption from `contracts/prices.ts`, copied into impact.json `assumptions`. They are not vendor prices. Change the file and re-run `make drill` to change them. Spend figures in the briefs are measured call counts multiplied by these prices.

| Tool | Price (USD) ASSUMPTION | Unit |
|---|---|---|
| `ledger.read` | $0.0002 | per call |
| `ledger.post` | $0.0005 | per call |
| `txn.lookup` | $0.0003 | per call |
| `kyc.lookup` | $0.0008 | per call |
| `docs.search` | $0.0004 | per call |
| `payments.transfer` | $0.0010 | per call |
| `fraud.flag` | $0.0002 | per call |
| `agent.call` | $0.0001 | per call |
| `approvals.enqueue` | $0.0001 | per call |
| `limits.get` | $0.0002 | per call |
| `mail.send` | $0.0005 | per call |
| `llm.complete` | $0.0050 | per call (pre-call estimate only) |
| `llm.in.per1k` | $0.0030 | per 1k tokens |
| `llm.out.per1k` | $0.0150 | per 1k tokens |

Model completions are recorded responses with pre-written token counts (`sim/recorded-llm.json`); the price of a completion is those counts times the per-1k rates.
