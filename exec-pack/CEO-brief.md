# Roll Call: executive brief

Numbers are from the last recorded run: impact.json generatedAt 2026-11-19T08:45:37.110Z, gitSha 8cf416e (chaos section run at 2026-11-19T08:45:37.109Z). generatedAt is the time of the latest merge into impact.json; sections run earlier keep their own measurements. The fleet, tools and model responses are simulated; the controls are real code. Results are from one laptop-class machine (see impact.json environment).

## The problem: four questions about every AI agent

1. **What is running?** An inventory entry with owner, purpose, risk rating, approved uses and scopes exists for each agent, and unregistered workloads are refused.
2. **What is it doing and spending?** Every call goes through a gateway that records the decision and the cost.
3. **Is each action allowed, and is there a record?** Scope, budget, throttle and policy are checked on every call; each decision lands in a hash-chained receipt anyone can verify.
4. **Can we stop it, and can we prove it stopped?** A kill revokes the identity, stops the runtime and then replays the agent's last action from outside; it must be refused.

**Why now.** OSFI Guideline E-23 (model risk management) takes effect May 1, 2027. Our engineering reading is that it expects an accurate, evergreen model inventory with owners, approved uses and monitoring, including monitoring that the model stays within its approved scope. An agent fleet changes faster than a quarterly inventory refresh. This is an engineering interpretation, not compliance advice; the mapping is in `e23-mapping.md`.

## Three numbers

| What | Result | Field in impact.json |
|---|---|---|
| Time to contain a runaway agent, p95 (over 20 drills; includes a SIMULATED owner acknowledgement of 1000 ms) | **2227 ms** | `drill.timeToContainMs.p95` |
| Of which time to hard throttle and page, p95 (automatic, no human) | **752 ms** | `drill.stagesP95Ms.paged` |
| Spend kept out per runaway drill, mean ($13.21 across all drills) | **$0.66** | `drill.spendProtectedUsd.protectedMean` |
| Extra end-to-end latency, difference of two p99s (governed minus ungoverned), loopback, no TLS, single process. Not production latency | **0.87 ms** | `bench.overheadP99Ms` |

Also measured: 12 agents registered and 0 running without a record; detector precision 1.00 and recall 1.00 for HARD containment with 0 hard false alarms, at 3 runs per case (small and scripted); soft alerts, which only throttle gently, appeared in 6 of 9 negative-case runs; low-risk success ratio 1.00 while the control plane was stopped. Dollar amounts use price assumptions (`cost-model.md`), not real invoices.

## Top three risks and what we do about them

1. **The results are from simulation.** Agents are scripted and faults are injected by us. *Mitigation:* the 30-day pilot phase is read-only discovery on real traffic, so baselines come from real agents before any enforcement.
2. **Failing closed has a business cost.** If the control plane is unreachable, high-risk tools are refused after the policy goes stale. *Mitigation:* low-risk work continued in the game day and high-risk calls were denied on purpose; the staleness limit is a setting the risk owner chooses (`docs/runbooks/control-plane-down.md`).
3. **A false alarm throttles a healthy agent.** *Mitigation:* a single signal only soft-throttles; two independent signals are needed for hard containment, and the owner is paged first. Measured hard false alarms are 0 on the labelled set (3 runs per case, small and synthetic), and soft alerts appeared in 6 of 9 negative-case runs; the pilot measures this on real traffic.

## Build, buy or extend

| Piece | Role | Position |
|---|---|---|
| agentgateway | Production data plane for agent, tool and model traffic | Extend: Roll Call's policy and receipts sit behind or beside it; our gateway is a reference |
| kagent | Kubernetes runtime for agents | Extend: agents run there, registered through the AgentRecord CRD |
| agent-sandbox | Isolated runtime for untrusted agent code | Extend: recommended runtime for agents that execute code |
| Microsoft Agent Governance Toolkit | Policy primitives | Extend: candidate policy adapter (ADR-002) |
| Langfuse | LLM traces | Extend: model-level traces; we record decisions, not prompts |

**What Roll Call adds is the control loop and the proof**: detection, graded response, a kill that is verified from outside, and receipts that show the record was not changed. These open-source projects each keep their own licence and are not affiliated with this work; the licence table is in `CTO-brief.md`.

## 30 / 60 / 90 day pilot

- **30 days, read-only discovery.** Register what exists; observe call patterns and spend; no enforcement. Output: a real inventory and real baselines.
- **60 days, enforce where it is safe.** Admission and budgets on low-risk agents; human approval on high-risk actions. Output: measured block rates and owner feedback.
- **90 days, evidence pack and decision.** Evidence aligned to the bank's own model inventory fields; then decide to expand or stop, using the numbers from the pilot, not these.

Verification: every figure here has a row in `verification-matrix.csv` with the command to reproduce it.
