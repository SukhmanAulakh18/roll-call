# Roll Call pitch

Roll Call watches AI agents at work and can stop one that goes wrong, with proof. It is a simulated fleet with real controls.

## Numbers rule

No number in this document is typed by hand. Every spoken figure is a slot such as `<<contain_p95>>`. Its value, its impact.json field and its spoken wording are in `print/pitch-numbers.md`, which `node print/build.ts` (or `make print`) generates from `impact.json`. After any new drill, run `make print` before you rehearse, then read the values from that file.

Labels always travel with the number: the overhead figure is end to end and on one laptop; time to contain includes a simulated owner acknowledgement; detector figures are for hard containment on small scripted runs; spend uses assumed prices.

## The 40-second pitch

Say it at a steady pace, about 100 words.

1. "Roll Call watches AI agents at work and can stop one that goes wrong, with proof."
2. "Every agent is registered. We have <<agents_registered>> agents, <<agents_running>> running, and <<agents_unregistered_running>> running without a record."
3. "Every call is checked against scope, budget and policy, and written to a receipt anyone can verify."
4. "In the drill, a runaway agent was contained at a p95 of <<contain_p95>>. That includes a <<owner_ack_simulated>> simulated owner acknowledgement. The automatic part, throttle and page, took <<auto_p95>> at p95."
5. "Across <<drill_runs>> drills, <<spend_protected_total>> of spend was kept out, at assumed prices."
6. "The fleet is simulated. The controls are real code, and every number on screen comes from this run."

## The 60-second add-on

Use this after the 40-second pitch, when the room asks for more.

1. "Most agent stacks leave the control loop to the operator. Ours has four parts: detect, throttle, page, and kill."
2. "A kill revokes the agent's identity, stops its runtime, then an outside probe replays the agent's last action. The probe must be refused. If it is not refused, the screen says the kill is not proven."
3. "Admission refuses any workload without a registered agent label, before it runs."
4. "The gateway adds <<overhead_p99>> at p99, end to end, on one laptop with no TLS. That is not production latency."
5. "For hard containment, the detector scored <<detector_precision>> precision and <<detector_recall>> recall on <<detector_runs_per_case>> runs per case. These are small, scripted runs. Soft alerts fired in <<soft_alerts_on_negatives>> negative-case runs, so the noise is on the record too."
6. "We ran <<chaos_game_days>> game days. The results are in the chaos section of impact.json and in the exec pack."
7. "The open-source projects are options we build beside. What we built is the control loop and the proof."

## Openers by audience

Each opener says what the demo shows. None says that the company uses, plans, has seen or endorses Roll Call. The headings name the room, not a relationship.

- **RBC / Borealis platform.** "This is what a platform team would see on one screen: the agent inventory, what each agent can touch, and the kill path with its proof."
- **TD.** "Start with the question a risk owner asks first: which agents exist, and who owns each one. Show the Registry, then the admission gate."
- **BMO.** "Start with spend. Every call is checked against a budget. Then show the drill where spend was kept out, at assumed prices."
- **TELUS.** "Start with containment. A runaway agent is throttled, paged and killed, and a probe shows it is refused. Then say what the simulated acknowledgement means."
- **Recruiters.** "Start with the build. A control loop and proof on top of open-source parts, measured honestly, with the limits stated first."

## Objection lines

- **"Doesn't X already do this?"** "Yes, I used the open-source pieces. What I built is the control loop and the proof."
- **"Is this real?"** "The fleet is simulated; the controls are real, and every number comes from this run. Here's the Verify button." Then press Verify on a tile.
- **"What would it take to pilot?"** The 30/60/90-day plan, which is a plan and not a measurement:
  - 30 days, read-only discovery. Register what exists, observe calls and spend, enforce nothing. Output: a real inventory and real baselines.
  - 60 days, enforce where it is safe. Admission and budgets on low-risk agents, human approval on high-risk actions. Output: measured block rates and owner feedback.
  - 90 days, evidence pack and decision. Evidence mapped to the bank's own inventory fields, then a decision to expand or stop, using the pilot's numbers and not these.
- **"What fails?"** "Start with the FMEA in `docs/FMEA.md`. For static stability: when control is down, low-risk work keeps running on the cached policy. High-risk calls are refused once that policy is stale. Nobody can kill an agent during that outage. The chaos results are in the `chaos` section of impact.json, and we say that openly." Then give the limits below if asked.

## Never say

- That a bank, a company or a regulator uses, plans, has approved or endorses Roll Call, or is a customer.
- That the data is real, that customers are involved, or that anything runs in production.
- That the overhead figure is decision latency or production latency. It is an end-to-end difference of two p99s.
- "Time to contain" without "including a simulated owner acknowledgement".
- "Zero false alarms", "100 per cent", or "perfect detection" without the hard-containment qualifier and the run count.
- "Saves", "savings", "ROI", "hours saved" or any dollar figure as a saving. Prices are assumptions.
- "Compliant", "meets the guideline" or "E-23 compliant". The E-23 mapping is an engineering interpretation, not compliance advice.
- "Guaranteed", "cannot be bypassed", "tamper-proof" or "secure" as absolutes. Receipts are tamper-evident with no external anchor yet. The gateway is a reference, not a security boundary.
- "The owner is paged first" without "simulated". No real page is sent.
- MTTD or MTTR. Those figures are configuration settings, not measurements.
- That agentgateway, kagent, agent-sandbox, the Microsoft governance toolkit or Langfuse is integrated or in use. They are options, and none is a dependency.
- "95 of 100 runs". There were <<drill_runs>> drill runs.
- Any owner name as a real person. Owner names are fictional.
- Anything about the OWASP threat model slide. Do not show it until its titles are reconciled with the official text.

## Honest limits

These come from `exec-pack/exec-review.md`. Say the first two before anyone asks.

1. The fleet is simulated. Agents are scripted, tools are mock services and model responses are recorded. Results show how the controls behave against these faults, not how real agents behave.
2. Drills are synthetic. Our own runner injects the faults, so detection rates describe those faults only.
3. The detector sample is small: <<detector_runs_per_case>> runs per case, hard containment only. Soft alerts fired in <<soft_alerts_on_negatives>> negative-case runs. In the ping-pong case, every run caused a collateral incident on another agent.
4. Time to contain includes a simulated owner acknowledgement. A real page would take longer; we have not measured that.
5. Overhead is a difference of two end-to-end p99s on one laptop, over loopback, with no TLS.
6. Prices and any savings are assumptions in `contracts/prices.ts`.
7. The gateway is a reference. Production should use agentgateway or an equivalent (ADR-001). A per-agent budget in agentgateway was not proven, and the Microsoft governance toolkit was not run end to end from the Node process.
8. The probe proves denial only at the gateways the control plane knows about. Nothing enforces gateway-only egress at the network layer.
9. There is no prompt-injection defence. The threat model says so.
10. Receipts have no external anchor yet, so tail truncation is not detected (ADR-008).
11. While the control plane is down, nobody can kill an agent or push a revocation, and the detector is blind.
12. The service does not yet refuse to start without `ROLLCALL_SECRET` outside demo mode.
13. The E-23 page is an engineering interpretation. The mapping to the bank's own inventory fields has not been done. It is not legal, regulatory or compliance advice.
14. Licences for the open-source components are not verified (README licence table is TBD).
15. Not affiliated with or endorsed by any company or regulator named.
