# The 90-second demo

Set up before anyone walks up: `make demo` running, browser at http://localhost:7100, presenter mode on, fleet reset. Fallback: `docs/media/roll-call-demo.mp4`.

| Time | Say | Do / show |
|---|---|---|
| 0–15 s | "Companies are starting to give AI agents the ability to take actions, not just answer questions. What happens when one goes out of control?" | Story page: headline and the incident card (Refund Processing Agent → stopped → further requests denied). |
| 15–35 s | "Here's an agent running as its own process, issuing refunds through Roll Call. Watch it try to go over its limit, then start repeating refunds." | Run `make external-demo` in a terminal beside the browser (or Drill → Run runaway loop). Point at the spend climbing in the "without controls" chart. |
| 35–55 s | "Roll Call blocks the over-limit refund, catches the loop, slows it, pages the owner, then stops the agent." | Timeline fills: detect → throttle → page → stop. Name the business consequence: "that's money that never left." |
| 55–75 s | "Stopped on a dashboard isn't proof. So a separate probe tries the same action again — and it's denied. Here's the receipt and timestamp." | Proof card → click the receipt id → side panel with verdict DENIED (REVOKED), time, and hash chain. |
| 75–90 s | "Under the hood: an enforcement gateway in the execution path, incident response, tamper-evident audit receipts, and containment tests that publish what is and isn't guaranteed. Every number has a Verify button." | Click Verify on time to contain; or show docs/containment.md. |

## If asked "isn't this just observability plus a kill switch?"
"Observability tells you after the fact. Roll Call is in the execution path — the action is refused, not just logged — and it proves containment with an independent check. It's also honest about the boundary: an action already past the gateway when the kill lands can complete, and the tests measure that."

## Say out loud (honesty)
- The agent fleet is simulated; the controls are real code; the refund agent is a real separate process using synthetic data.
- Time to contain includes a simulated one-second owner acknowledgement.
- Dollar figures use assumed prices; the ROI page separates measured inputs from modelled projections.
