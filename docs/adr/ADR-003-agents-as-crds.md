# ADR-003: Agents as CRDs, with AgentRecord separate from the runtime

Status: Accepted (design)

## Context
Roll Call governs AI agents. Each agent needs an inventory entry (owner, purpose, risk rating, scopes, budgets, evaluation evidence, lifecycle state) that auditors and owners can read. Each agent also runs on some runtime: a Deployment, a kagent `Agent`, an agent-sandbox `Sandbox`, or in the offline demo a simulated process. The runtime is a choice we should not hard-code into the governance record, because runtimes change faster than inventory rules do.

## Options
1. Use the runtime object as the record. A kagent `Agent` or a `Deployment` carries the governance fields as annotations or extra spec.
2. Keep a separate `AgentRecord` resource (CRD) that describes the agent. Each runtime object references it through `runtimeRef`.
3. Keep the inventory outside Kubernetes, in a database or spreadsheet, and check it at admission.

## Decision
Option 2. `AgentRecord` is a custom resource. It mirrors the TypeScript `AgentRecord` in `contracts/types.ts` and is the single source for admission, policy bundles and the inventory view. The runtime object carries the label `rollcall.dev/agent-id` and points back to the record. Admission denies any workload with no label, no matching record, or a record that is retired or not yet evaluated for production use. The same record attaches to any runtime kind (`Deployment`, `Agent`, `Sandbox`, `SimProcess`).

## Consequences
- Governance survives a runtime swap. Moving an agent from a Deployment to a kagent `Agent` changes `runtimeRef` and nothing else.
- Two objects must agree. Admission and a periodic reconciler check that every running workload has a record and that every record has a live workload or is marked retired.
- Inventory fields such as `evaluation` and `budgets` are visible to the owner in one place, which helps audit review.
- The CRD schema is a public contract and needs versioning from the start.

## Evidence
Design only. The offline demo uses `FLEET: AgentRecord[]` in `sim/fleet.ts`. The CRD in `deploy/k8s/agentrecord-crd.yaml` is planned and does not exist yet (see ADR-010).
