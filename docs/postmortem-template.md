# Postmortem: <short title>

- Incident id(s): <ids from `GET /v1/incidents`>
- Date and time of first symptom (UTC): <>
- Date and time of resolution (UTC): <>
- Severity: <sev level as defined by the owner>
- Status: draft | reviewed | closed
- Authors: <roles, not personal names in shared copies>
- Review date: <>

## Summary
One paragraph. What happened, what was affected, how it was found, how it was stopped.

## Impact
- Agents affected: <agent ids and their risk rating>
- Tools affected: <tools; mark any high-risk tool>
- Calls denied, throttled or allowed that should have been denied: <counts from receipts>
- Spend affected: <measured figures from the source system, not estimates>
- Customer or data impact: <none / describe>

## Timeline
| Time (UTC) | Stage or event | Source (incident stage, receipt id, log, person role) |
|---|---|---|
| | detected | |
| | throttled / paged | |
| | owner ack | |
| | killed | |
| | proof | |
| | resolved | |

## Detection
- How was it detected: detector, owner, monitoring, other.
- Did the detector fire as designed? Signals and their values: <from the incident>
- Time from first symptom to first detection: <measured>

## Response
- What was done, in order, and by which runbook (`docs/runbooks/...`).
- Did any step not match its runbook? Describe the gap.

## Verification of containment
- Proof record: <receiptId, attemptedTool, verdict, code>
- Receipt chain status for affected replicas: <ok / broken, with brokenAt>
- Runtime state after containment: <stopped / scaled to zero / other>

## Root cause
State the direct cause and the contributing causes. Use the five whys or fault tree, whichever fits. Avoid blame; describe conditions.

## What went well

## What went badly

## Action items
| Action | Owner (role) | Due | Tracking |
|---|---|---|---|
| | | | |

## Evidence
- Links to incident export, receipts, logs and `impact.json` from the relevant drill (`make drill` or `make chaos`), if the incident was reproduced in the demo.
