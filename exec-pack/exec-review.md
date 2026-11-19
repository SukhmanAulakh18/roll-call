# Exec review: an independent skeptic's pass

Reviewer: independent, did not build this. Date: 2026-11-19 (demo is Fri 2026-11-20).
Inputs: README.md, exec-pack/*, docs/* (architecture, ADR-001 to ADR-013, FMEA, availability model, latency budget, CI, runbooks), impact.json (generatedAt 2026-11-19T07:19:06.564Z, gitSha 1a8d073), contracts/, and a read of services/, sim/, scripts/, deploy/k8s/ and ui/src. I also ran the real stack (`node scripts/serve.ts --ui ui/dist`, no fixture) and drove it with Playwright. Screenshots are in `ui/screenshots/review-*.png`; the design findings are in `docs/design-critique.md`.

Overall: the engineering honesty is well above the norm. Limits are stated, assumptions are labelled, every brief number traces to an impact.json field, and the chaos game days found and fixed two real defects. The weak spots are (a) a few numbers whose labels promise more than the measurement does, (b) three places where the code does not do what the ADR/FMEA says it does, and (c) two demo-breaking UI bugs in real mode that the existing screenshots (taken in fixture mode) did not catch.

Verdict tally: **6 RESOLVED, 19 KNOWN LIMIT** (25 questions).

---

## 1. The 25 hardest questions

Legend: **RESOLVED** = the repo answers it with evidence that holds up. **KNOWN LIMIT** = the honest answer is "not yet", or the evidence is weaker than the claim.

### Skeptical CEO

**Q1. What does it save, with my numbers?**
Answer: Nothing in the repo takes "my numbers". The measured figure is $0.66 kept out per 12-second runaway window, at made-up per-call prices ($13.21 over 20 synthetic runs). The useful fact is buried: an ungoverned runaway burned $0.70 in 12 s, about $3.50/min, about $210/hour per stuck agent at the assumed prices. The governed run stopped it at $0.04. The Value ledger in the UI accepts hours saved and an hourly rate, but impact.json has no defaults, so it shows "No assumption set".
Evidence: `impact.json drill.spendProtectedUsd`, `drill.callsMean` (476 vs 67 calls), `contracts/prices.ts`, UI `#/value`.
Verdict: **KNOWN LIMIT**. Fix: a one-line "per-runaway-hour" figure plus an input for "agents in fleet x runaways per year x hours to notice today".

**Q2. What if the detector is wrong?**
Answer: Response is graded. One signal only soft-throttles; two signals hard-throttle and page; kill needs policy or the owner. Measured: 0 hard false alarms and 0 misses. But n = 3 runs per case (9 positive, 9 negative), the "false alarm" definition counts only hard containment, and soft alerts fired on 6 of 6 healthy-burst and slow-repeat runs (`detected: 3` each). In my live session a healthy steady-state fleet raised a "cycle suspected" alert toast for Credit Memo Drafter with no drill running (`review-first-paint.png`). With 9/9, the 95% lower confidence bound on precision is about 0.66, not 1.00.
Evidence: `impact.json detector.cases`, `detector.definition`, ADR-007, FMEA row 6.
Verdict: **KNOWN LIMIT**.

**Q3. Why not the cloud vendor's tooling?**
Answer: The repo positions Roll Call as "extend, not replace" and argues the gap is the control loop plus proof (verified kill, tamper-evident receipts). That argument is plausible, but there is no side-by-side against any hyperscaler's agent governance offering, so the question gets an opinion, not evidence.
Evidence: README "Positioning", CEO-brief "Build, buy or extend".
Verdict: **KNOWN LIMIT**. Fix: a 5-row comparison (inventory, per-call policy, verified kill, receipts, multi-cloud) with "unknown" where unknown.

**Q4. What's the 90-day pilot?**
Answer: 30 days read-only discovery, 60 days enforce on low-risk agents with human approval on high-risk, 90 days evidence pack and an expand/stop decision on pilot numbers. Clear and appropriately cautious. Missing: success thresholds for the day-90 decision, team size and cost.
Evidence: `exec-pack/CEO-brief.md` "30 / 60 / 90 day pilot".
Verdict: **RESOLVED** (add exit criteria before anyone asks).

**Q5. Who owns it?**
Answer: Each agent has an owner, reviewer, approver and escalation. Roll Call itself does not: no RACI says which team runs the control plane, holds the Tier-0 issuer key, or approves policy bundles. The architecture diagram says "Platform on-call", which is a role, not an owner.
Evidence: `docs/architecture.md` C4 L1; `contracts/types.ts` AgentRecord.
Verdict: **KNOWN LIMIT**.

### Skeptical CTO

**Q6. What is the p99 overhead versus ungoverned?**
Answer: 0.87 ms, computed as end-to-end p99 governed (14.50 ms) minus end-to-end p99 direct (13.63 ms). It is a difference of two p99s, not the p99 of the per-call overhead. It was measured on loopback, plain HTTP, no TLS, no network hop, with the load generator, mock tools and control on the same 4 cores. The design budget itself allows 2 ms for TLS alone. The in-gateway decision path is 0.09 ms p99. Honest reading: "the policy logic is not the bottleneck"; production overhead is unknown until measured with TLS on a real network.
Evidence: `scripts/bench.ts` line 33, `impact.json bench`, `exec-pack/latency-budget.md`.
Verdict: **RESOLVED** as a laptop measurement; see claims audit C1 for the labelling problem.

**Q7. What fails closed, what fails open, and why?**
Answer: Low-risk tools fail open on the cached bundle (static stability). High-risk tools fail closed once the bundle is older than 2 s (`STALE_POLICY_HIGH_RISK`, 40 of 40 denied after staleness). Expired tokens fail closed (0 calls allowed after expiry). New identities and admissions fail closed (webhook `failurePolicy: Fail`). Telemetry fails open with counted drops (408 dropped, accounting balances). Kill fails closed: it needs control. The reasoning is written down per component.
Evidence: `impact.json chaos.scenarios.*`, ADR-004, ADR-013, `make chaos`.
Verdict: **RESOLVED**.

**Q8. What if the control plane dies?**
Answer: Measured: running low-risk work continued at 1.00 success, high-risk was denied after staleness, gateways and agents did not restart, and the fresh bundle arrived 13 ms after control returned. Stated limit: during the outage nobody can kill an agent or push a revocation, and the detector is blind. Budgets keep working because they are enforced in the gateway.
Evidence: `impact.json chaos.scenarios.control-plane-stop`, `docs/runbooks/control-plane-down.md`.
Verdict: **RESOLVED** (with the limit stated; "MTTR 13 ms" is mislabelled, see C8).

**Q9. How does it scale out?**
Answer: Gateways are stateless with respect to each other and write per-replica receipt chains. Two replicas were tested with failover. But budget windows are held in each gateway's memory (`services/gateway/src/app.ts` line 119), so with N replicas an agent's effective hourly and daily budget is up to N times the configured value, and it resets when a gateway restarts. Throughput was measured on one gateway only (2279 req/s, co-located load generator). No horizontal test, no k6 run.
Evidence: `impact.json bench`, `chaos.scenarios.gateway-replica-loss`, CTO-brief "Capacity note".
Verdict: **KNOWN LIMIT**. This one will surprise a CTO; say it before they find it.

**Q10. What is our license exposure?**
Answer: Runtime dependencies of the backend: none. UI bundle: MIT, ISC, Apache-2.0, OFL-1.1, read from installed manifests. But the README licence table is all "TBD", including Roll Call's own licence, and there is no LICENSE file in the repo. ADR-001 says agentgateway is Apache 2.0 and ADR-002 says the Agent Governance Toolkit is MIT, which contradicts the README's "TBD".
Evidence: `exec-pack/CTO-brief.md` licence table, README "Licences", ADR-001, ADR-002, ADR-012.
Verdict: **KNOWN LIMIT**.

**Q11. Why not just agentgateway, or Microsoft's Agent Governance Toolkit?**
Answer: Both were spiked with recorded commands. agentgateway: per-agent kill by config hot-reload worked; per-agent budget was not proven (`localRateLimit` is per route). AGT: Python only, public preview, cannot embed in the Node process; policy decisions were not executed end to end. Roll Call keeps both as adapters behind interfaces and claims only the loop and the proof. Defensible.
Evidence: `docs/adr/ADR-001-gateway.md`, `docs/adr/ADR-002-policy-engine.md`.
Verdict: **RESOLVED**.

**Q12. How do you upgrade when MCP, A2A or OTel GenAI conventions change?**
Answer: ADR-009 describes an OTel adapter layer so a rename changes one file. That adapter does not exist in code: the gateway exposes Prometheus text at `/metrics` and there is no OTel mapping file. There is no MCP or A2A protocol handling in `services/` at all: "A2A" is a `targetAgentId` field and MCP is "can front" in the README. So there is nothing to upgrade yet, and nothing proves the adapter design works.
Evidence: ADR-009; `grep -ril mcp services sim contracts` returns nothing.
Verdict: **KNOWN LIMIT**.

**Q13. Does it run on our Kubernetes?**
Answer: Partly. The AgentRecord CRD and the ValidatingAdmissionPolicy were exercised against a real kube-apiserver 1.31 (`deploy/k8s/admission-demo.out.txt` shows the unlabelled `shadow-bot` refused with a readable message). The record-lookup webhook layer was not exercised because nodes could not start pods in the build sandbox. The VAP layer only checks that a label exists, so it can be forged; the webhook is the real check and it is the unproven part. README still calls `kind-up` and `admission-demo` "planned".
Evidence: ADR-013, `deploy/k8s/policies.yaml`, `make kind-up`, `make admission-demo`.
Verdict: **KNOWN LIMIT**.

### Skeptical CISO

**Q14. How is identity scoped and revoked?**
Answer: Short-lived HMAC tokens (60 s TTL; 3 s in the game day) with a SPIFFE-style subject, bound to the agent id. Revocation is two-part: the revocation list in the bundle and the issuer refusing renewals. Measured: 0 calls allowed on an expired token. Weaknesses: one symmetric secret for the whole system, with a hard-coded fallback (`rollcall-dev-secret-not-for-production` in `services/control/src/identity.ts`) if `ROLLCALL_SECRET` is unset, so any component that can verify a token can also mint one. Production design is SPIRE.
Evidence: ADR-005, `impact.json chaos.scenarios.identity-issuer-down`, `make acceptance` (DoD3).
Verdict: **KNOWN LIMIT**. Make the service refuse to start without `ROLLCALL_SECRET` outside demo mode.

**Q15. How do you KNOW the kill worked?**
Answer: An independent probe (its own HTTP path) replays the agent's last tool call and must get `DENY (REVOKED)`; the receipt id is shown. That part is real and the drill showed it (`review-drill-after.png`). Three gaps in code:
1. If the probe is not denied, or cannot reach any gateway, `engine.ts` still emits a stage called `proof` ("kill is recorded in the bundle but not proven"), and `sim/drills.ts` computes time-to-contain from the `proof` stage regardless of verdict. ADR-006 and FMEA row 10 both say an unproven kill stays open and has a null time-to-contain. The code does not do that.
2. Runtime stop is `Promise.race([stop(), sleep(2000)])` and then the message says "runtime ... stopped" whether or not stop finished.
3. If the agent's old token has under 3 s left, the probe mints a new 15 s token for the agent, but the message still says "with the agent's old token".
It also proves denial at the gateways the control plane knows about; it does not prove the process cannot reach a tool directly.
Evidence: `services/control/src/engine.ts` lines 113 to 150, `sim/drills.ts` line 44, ADR-006, FMEA row 10, `tests/acceptance/dod.test.ts` DoD3.
Verdict: **KNOWN LIMIT**. The fix is about 10 lines: emit `unproven` instead of `proof` unless the verdict is deny/REVOKED.

**Q16. What stops goal hijack?**
Answer: Nothing prevents it; it is bounded. Per-agent tool and model allow-lists, budgets, throttles and the scope-drift detector limit what a hijacked agent can do. There is no prompt-level injection defence, and the threat model says so.
Evidence: `exec-pack/threat-model.md` ASI01, `services/gateway/src/policy.ts`.
Verdict: **KNOWN LIMIT**.

**Q17. Is the record tamper-evident? Show me.**
Answer: Yes for edits: `make verify` changes one field and the chain check names the exact record; the UI has a "Verify chain" button. But the hash is plain SHA-256 with no key, signature or external anchor, so anyone with write access to the JSONL can rewrite the whole tail and recompute every hash, and truncation is not detected. ADR-008 says this. "Tamper-evident" is true against careless edits, not against an insider.
Evidence: `services/gateway/src/receipts.ts`, ADR-008, `make verify`, DoD7.
Verdict: **KNOWN LIMIT**. Show it live, then say the anchor sentence before the CISO does.

**Q18. Can an agent bypass the gateway?**
Answer: In the demo, yes, by design: the gateway serves `POST /v1/direct`, which skips identity, scope, budget, throttle and masking. It is used to run the ungoverned baseline. It has no flag or authentication and ships in the same service as the governed path. In production nothing in the repo enforces "only through the gateway" at the network layer (no NetworkPolicy, no egress control).
Evidence: `services/gateway/src/app.ts` lines 146 to 161.
Verdict: **KNOWN LIMIT**. Put `/v1/direct` behind an explicit `--allow-ungoverned` flag and say so in the threat model.

### Skeptical Head of Model Risk

**Q19. Does this give me an E-23-grade inventory?**
Answer: It gives an engineering inventory (owner, purpose, risk rating, lifecycle, approved uses, limitations, evaluation flag, data sources, origin) and refuses unregistered workloads. The mapping to the bank's own inventory fields has not been done, and the E-23 page is an engineering interpretation, correctly labelled as not compliance advice.
Evidence: `exec-pack/e23-mapping.md`, `contracts/types.ts`.
Verdict: **KNOWN LIMIT**.

**Q20. Would you approve a detector validated on 18 scripted runs?**
Answer: No, and the repo does not ask you to. Rules are deterministic and explainable, which helps. But thresholds are hand-set, there is no out-of-sample test, no slow-drift or adversarial case beyond `slow-repeat`, and 3 runs per case of a deterministic simulation are close to one run repeated.
Evidence: `impact.json detector`, ADR-007, `.github/workflows/red-team.yml`.
Verdict: **KNOWN LIMIT**.

**Q21. What is the evaluation evidence behind "Passed"?**
Answer: `evaluation` is a pass flag and a date. There is no link to a validation report, metric, dataset or validator. Admission checks the flag, so a record can be made admissible by setting it.
Evidence: `contracts/types.ts`, `services/control/src/admission.ts`, UI Registry "Passed".
Verdict: **KNOWN LIMIT**.

**Q22. Who approves a change to thresholds, scopes or budgets?**
Answer: ADR-007 says thresholds go "through the bundle like any other policy change". The bundle has a version number but no approval workflow, signature or diff review; anyone who can write to control can publish one. The gateway now rejects malformed bundles, but a well-formed wrong bundle is accepted.
Evidence: ADR-007, `docs/runbooks/bad-policy-bundle.md`, FMEA row 3 (rated High severity).
Verdict: **KNOWN LIMIT**.

### Business analyst

**Q23. Who owns this agent?**
Answer: Every record has owner name, team, escalation target, reviewer and approver; the agent panel shows them in one click (`review-agent-panel.png`). Names are fictional. One inconsistency: the k8s samples give different owners and risk ratings than the live registry (for example invoice-recon is `Dana Okafor, low, shadow` in `deploy/k8s/admission-demo.out.txt` but `Hiro S., medium, production` in the UI).
Evidence: `contracts/types.ts`, UI `#/registry`, `deploy/k8s/samples`.
Verdict: **RESOLVED** (align the samples).

**Q24. What value does each agent deliver, and how is it measured?**
Answer: It is not measured. Spend is measured per agent; value is a user-entered assumption (hours saved per task times an hourly rate) with no defaults, so every agent panel reads "Value per day: No assumption set".
Evidence: `ui/src/screens/Money.tsx` ValueLedger, `impact.json assumptions` (no value fields).
Verdict: **KNOWN LIMIT**.

**Q25. What needs my approval, and how long has it waited?**
Answer: Nowhere to see it. `approvals.enqueue` exists as a mock queue inside the tools service (`sim/tools.ts`), with no API, no UI and no age. The only "approval" in the incident flow is the owner acknowledgement, which is auto-acknowledged after 1000 ms and labelled SIMULATED.
Evidence: `sim/tools.ts` lines 31 to 38, `services/control/src/engine.ts` line 105.
Verdict: **KNOWN LIMIT**.

---

## 2. Claims vs evidence audit

Every number in README.md, exec-pack/*.md and the UI hero row (`ui/src/screens/Fleet.tsx` `Hero()`) was checked against impact.json. **All numbers match their fields** (the `make verify` claim checker enforces this). The README states no numbers. The problems are in labels, context and code, not arithmetic.

| # | Claim (where) | Problem | Type |
|---|---|---|---|
| C1 | "Added decision latency at p99, 0.87 ms" (CEO-brief); "Gateway decision overhead vs ungoverned, p99" (verification-matrix); UI Engineering lens tile "Decision-path time with controls minus the ungoverned baseline" | `overheadP99Ms` is end-to-end p99 governed minus end-to-end p99 direct (`scripts/bench.ts` line 33). It is not decision latency, and it is a difference of p99s. Loopback, no TLS, no network, generator on the same 4 cores. CTO-brief labels it correctly ("end to end"); the CEO brief, the matrix and the UI do not. | Misleading |
| C2 | "Gateway decision path p99 0.0901 ms" (CTO-brief) | An in-process timer around the decision code. Four significant figures imply precision a laptop timer does not have. No caveat that it excludes I/O, TLS and serialisation. | Overstated precision |
| C3 | "Spend kept out per runaway drill $0.66", "$13.21 across all drills" (CEO-brief, UI hero "kept out of runaway drills") | Correctly labelled as assumed prices, but $13.21 sits under "What does it cost?" on the home screen, inviting a reading as savings. It is 20 x 12 s synthetic windows. The executive-relevant number (about $210 per runaway-hour at these prices) is not stated. | Misleading by framing |
| C4 | "Time to contain p95 2225 ms" (CEO-brief, CTO-brief, UI hero "2.2 s") | About 1000 ms of it is a simulated owner auto-ack (`ackMs` default 1000; stages: detected 752, owner_ack 1997, killed 1999, proof 2225). The automatic part (detect and throttle) is 0.75 s. A real human page would take minutes. The figure is "time to contain with a 1-second fake human". | Misleading without caveat |
| C5 | UI Verify sheet: "95 of 100 runs were this quick or quicker" | There were 20 runs. p95 of 20 samples is essentially the second-slowest run. | Wrong |
| C6 | "detector precision 1.00 and recall 1.00 with 0 false alarms" (CEO-brief); "Does the detector cry wolf? 1.00" (UI eng lens) | n = 3 per case (9 positives, 9 negatives). "False alarm" counts only hard containment; soft alerts fired on 6 of 6 healthy-burst and slow-repeat runs. Every ping-pong run caused a collateral incident on another agent (`collateral: 3`), unreported in the briefs. A healthy fleet raised a soft alert during my session. | Overstated |
| C7 | "12 agents registered and 0 running without a record" (CEO-brief) | True but close to tautological: the simulated runtime only starts registered agents. The real evidence for "nothing unregistered runs" is the admission test (DoD4) and the VAP run, not this counter. In my live session the hero read "11 of 12" before any drill because a revocation from an earlier run persisted in `data/registry.json`. | Weak evidence |
| C8 | "MTTD 2008 ms", "MTTR 13 ms" (CTO-brief, control-plane stop) | MTTD equals the configured staleness limit (2000 ms) plus poll jitter; it is a setting, not a detection measurement. MTTR is the time for a gateway on localhost to fetch a fresh bundle after control was restarted by a script. Neither is an operational MTTD/MTTR (no human, no alerting, no restart time). | Misleading labels |
| C9 | FMEA row 10: "Incident stays at killed without proof", "timeToContainMs null otherwise"; ADR-006: "If the probe is not denied, the incident stays open and pages a human" | Not what the code does (Q15). An unproven kill emits a `proof` stage and counts as contained. | Unsupported by code |
| C10 | Probe message "replayed ... with the agent's old token" (UI drill, incident banner) | `engine.ts` mints a fresh 15 s token when the old one has under 3 s left. | Sometimes false |
| C11 | Kill message "runtime ... stopped" | Printed after `Promise.race` with a 2 s sleep, whether or not stop completed. | Unsupported |
| C12 | UI live spend "$0.30 to $0.68 per min" vs `impact.json fleet.baselineSpendPerMinUsd` 0.0751 | A 4x to 9x gap between the live hero and the recorded baseline, unexplained. A sharp analyst will compare them. | Inconsistent |
| C13 | README: "Status: the code is still being built. Several targets depend on files that do not exist yet"; `kind-up` and `admission-demo` "(planned)" | Stale: deploy/k8s exists and ran. But `make replay` calls `scripts/replay.ts`, which does not exist, and the UI's Replay empty state tells users to run it. | Stale / broken |
| C14 | README licence table all "TBD"; ADR-001 "agentgateway (Apache 2.0)", ADR-002 "AGT (MIT)" | Inconsistent; no LICENSE file for Roll Call itself. | Unsupported |
| C15 | `docs/adr/README.md` index | Lists ADR-001 to ADR-012; ADR-013 (admission) exists but is missing from the index. | Stale |
| C16 | "Owner is paged first" (CEO-brief risk 3) | The page and the owner acknowledgement are simulated (impact.json `assumptions.simulatedPager` says so; the brief does not, at that point). | Needs caveat |

### Real companies, affiliation and real-data flags

- **ADR-002**: "OPA ... its creators joined Apple in 2025, so treat long-term stewardship as a watch item." This is an unsourced statement about a real company and real people, in a document an external audience may read. Remove it or cite a public source.
- **README "Positioning" table** header is "Used for", listing agentgateway, kagent, agent-sandbox, Microsoft Agent Governance Toolkit, Langfuse. None of them is a dependency (the CTO brief says so). "Used for" reads as integration. Rename the column to "Considered for" or "Design option for". The CEO brief's "Extend: candidate policy adapter" for Microsoft AGT is fine, but no adapter code exists, so "candidate" must stay.
- **Disclaimers present and good**: README "Not affiliated with or endorsed by any company or regulator named here"; UI footer "not affiliated with any bank"; ADR-011 requires fictional names. No real bank, telco or person is named as a customer. No real bank data: data scopes are `synthetic-*`, tools are mocks, model outputs are recorded.
- **OSFI E-23**: named as a regulator with an "interpretation, not advice" caveat and "confirm the date" in the matrix. Acceptable; keep the caveat on any slide that shows the date.
- **Fictional people**: owner names (Priya Nair, Marc Tremblay, Dana Okafor, Hiro S. and others) are fictional but realistic. Add "(fictional)" next to owners in the Registry header once, the way pager targets say "(simulated)".
- **Threat model**: titled "OWASP Top 10 for Agentic Applications 2026" with titles "pending reconciliation with the official OWASP text". Honest, but do not show that slide until reconciled.

---

## 3. Top 5 fixes before Friday, ranked by demo risk

1. **The Engineering lens and Engineering page crash the whole app in real mode.** `Fleet.tsx` line 109 and `Engineering.tsx` line 118 render `det.cases`, which is an object in the real impact.json (it is the number 60 in the fixture). React throws error #31 and the page goes blank (`review-lens-eng-home.png`, `review-engineering.png`). The lens is saved to localStorage, so after one click every reload is blank until storage is cleared. Fix: render `det.tp + det.fp + det.fn + det.tn` (18) and add an error boundary around each screen. About 5 minutes.
2. **Replay is empty in real mode.** The UI fetches `/replay/events.json`; the server answers with the SPA's index.html (HTTP 200, text/html), so the page says "No recording yet ... run `make replay`", and `make replay` points at a missing script (`review-replay-390.png`). The server already serves the same file at `/v1/replay`. Fix: point the UI at `/v1/replay` (or serve `replay/`), and fix the Makefile target. Replay is the fallback if the live stack fails on stage, so this is high risk.
3. **The demo boots with a killed agent.** Revocations persist in `data/registry.json`, so a fresh `serve.ts` showed "11 of 12", "1 killed" and a red Invoice Reconciliation card before anything happened (`review-home.png`). Fix: reset on boot in demo mode, or add `make clean` and a "Reset fleet" press to the pre-show checklist.
4. **Relabel the three numbers a CTO or CISO will attack** (C1, C4, C6): "0.87 ms extra at p99, end to end, on one laptop, no TLS"; "2.2 s to contain, including a 1 s simulated owner acknowledgement; 0.75 s to detect and throttle automatically"; "0 hard false alarms on 18 scripted runs; soft alerts on busy-but-healthy agents". Fix the "95 of 100 runs" text (C5). These are copy changes in `scripts/exec-pack.ts`, `scripts/lib/claims.ts` and the UI Verify specs.
5. **Make "proof" mean proof** (Q15, C9 to C11): emit `unproven` unless the probe verdict is deny with code REVOKED, exclude unproven kills from time-to-contain, report runtime stop only when it resolved, and say "fresh token" when one is minted. Also put `/v1/direct` behind a flag (Q18). If the code cannot change before Friday, change the FMEA row 10 and ADR-006 wording to match the code, so the documents never claim more than the code does.
