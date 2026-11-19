# E-23 mapping

**Engineering interpretation, not compliance advice.** OSFI Guideline E-23 is stated to take effect May 1, 2027. The themes below are our reading of what an accurate, evergreen model inventory with owners, approved uses and monitoring (including monitoring of scope) asks of an engineering team. Confirm every row against the guideline text with the bank's model risk and legal functions. Roll Call is a technical control set, not a model risk framework.

| Theme | What we read it to need | Roll Call control | Test or make target |
|---|---|---|---|
| Inventory | Every agent has a current record: purpose, owner, risk rating, version, data sources, approved uses, limitations; nothing runs unlisted. | `AgentRecord` (`contracts/types.ts`), registry (`services/control/src/registry.ts`), admission refuses unregistered workloads (`services/control/src/admission.ts`, `deploy/k8s/`) | `make acceptance` (DoD4); `npm test` (admission rules); `deploy/k8s/admission-demo.out.txt` |
| Lifecycle | Defined stages, evidence before promotion, controlled change. | `lifecycleState` draft, shadow, canary, production, retired; production and canary need passing evaluation; shadow agents cannot use high-risk tools | `npm test` (admission, gateway policy) |
| Ownership | Named owner and escalation path; accountability for changes. | `owner`, `reviewer`, `approver`, `escalation`; incidents page the owner and wait for acknowledgement (simulated pager) | `make drill` (page and owner_ack stages) |
| Monitoring, including approved scope | Ongoing monitoring against the approved use; detect drift from scope; review dates. | Tool and model scopes enforced per call; scope-drift detector; spend and rate baselines; `reviewDate`, `nextMonitoringDate`; hash-chained receipts | `make drill` (scope-drift drill, detector counts); `make verify` (chain check) |
| Third-party and vendor origin | Know whether an agent or model is internal, vendor or open source; carry vendor risk. | `origin` field on every record. No vendor attestation or SBOM check is implemented (limit). | `npm test` (record fields); no test for vendor assurance |
| AI and ML specifics | Model and data provenance, evaluation evidence, limits of use, drift and misuse monitoring. | `models` allow-list per agent, `evaluation` evidence, `dataSources`, `limitations`; recorded model responses in the demo. Bias, explainability and model validation are not implemented (limit). | `npm test` (model not allowed); `make acceptance` |
| Decommissioning | Retire cleanly; no residual access. | `retired` state is refused at admission and by the gateway; kill revokes identity, stops the runtime and proves the agent is refused | `make acceptance` (DoD3 kill with proof); `docs/runbooks/kill-and-verify.md` |

Pilot output for the bank's own inventory: a mapping of `AgentRecord` fields to the bank's model inventory fields is a pilot task (90-day phase in the CEO brief); it has not been done.
