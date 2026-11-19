# ADR-011: A simulated fleet with real controls, and a Replay mode from recorded events

Status: Accepted (design)

## Context
Roll Call has to be shown working without any real bank data, real customers or real model spend. Real agents are not available offline, and real incidents cannot be created on demand. But a demo that only shows a dashboard proves nothing about the controls. The controls have to be real code paths that a fault actually hits.

## Options
1. Mock the controls (fake the kill, fake the receipts). Easy to build, but it proves nothing.
2. Real controls against a simulated fleet of scripted agents, with synthetic faults injected. Agents, tools and models are simulated. Gateway, policy, identity, detector, kill and receipts are the real code.
3. Real agents against real tools in a lab. Most realistic, but needs infrastructure and approvals not available here.

## Decision
Option 2, plus a Replay mode. The fleet is twelve fictional, banking-flavoured agents (`sim/fleet.ts`). Tools are mock bank services with deterministic responses and recorded model output (`sim/tools.ts`, `sim/recorded-llm.json`). Faults are injected by the drill runner (`sim/drills.ts`). Every governed and ungoverned run writes events. Replay mode rebuilds a static page from the recorded events of the last run (`make replay`), so the result can be shown without starting the stack.

## Consequences
- Every claim is labelled as simulated: fleet, tools, model responses and prices. The UI and README say so.
- Results depend on the scripted behaviour. Drill results show that the controls work against these faults, not that they would catch every real fault. The honest limits are in the README.
- Replay is reproducible: the same recorded run gives the same page.
- Fictional agent names and the fictional bank setting must not be tied to any real institution.
