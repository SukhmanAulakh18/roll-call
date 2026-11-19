# Design critique: Roll Call control room

Reviewer: independent. Date: 2026-11-19, the day before the demo.
Method: built the UI (`cd ui && npm run -s build`), ran the real stack (`node scripts/serve.ts --ui ui/dist`, ports 7100/7200/7300, no fixture), and drove it with Playwright in Chromium at 1440x900 and 390x844. I captured home, agent panel, drill before, during and after "Run runaway loop", admission rejection, Operations and Engineering lenses, the Engineering page, presenter mode, keyboard focus, the Verify sheet, Spend and Registry, and the Replay page on a phone. All screenshots are `ui/screenshots/review-*.png`.

Important: the existing `ui/screenshots/v2-*.png` appear to have been taken in fixture mode. Two of the most serious problems below (the Engineering crash and the empty Replay) only appear in real mode, which is what the audience will see.

---

## The 5-second test

Question: a non-technical person looks at home for 5 seconds. Can they say "it watches AI workers and can stop one that goes wrong"?

**Verdict: narrow FAIL.** They will get "it watches something and can stop it in 2.2 seconds". They will not get "AI".

Reasoning, from `review-first-paint.png` and `review-home.png`:
- **The word "AI" appears nowhere on the home screen.** The brand is "Roll Call", the tiles say "agents", the footer says "Simulated fleet". At a bank or telco careers event, "agents" first means contact-centre staff. The audience has to infer "AI" from tool names like `llm.complete`.
- **The four tile questions work.** "What agents exist? / What does it cost? / Can I stop one, fast? / Can I prove it?" is the strongest copy in the product and carries most of the message. "Can I stop one, fast? 2.2 s" gets half of "can stop one that goes wrong".
- **The eye lands on the map, not the tiles.** About 60% of the viewport is a wiring diagram: 12 agent cards, 12 tool chips, more than 10 data chips and around 100 bright blue curves. It looks impressive and reads as "complex network", not "AI workers being watched".
- **"Goes wrong" is not visible at rest.** At boot one agent was already "Stopped" in red with no explanation (leftover state, see issue 3), and a toast said "Credit Memo Drafter is off its baseline - cycle suspected". A first-time viewer sees something red and something alarming, with no story.
- Small text under the numbers ("over 20 drills, until the probe is refused", "0 denied or slowed so far") is engineer language.

**Fix (about 15 minutes):** add one sentence above the tiles, at hero size and in plain words: *"Roll Call watches every AI agent at work. If one goes wrong, it stops it and proves it stopped."* Put a large "Run a runaway drill" button next to it on the Executive lens. With those two changes, I expect the test to pass.

---

## Top 10 issues, ranked by severity

Severity: **P0** breaks the demo; **P1** a viewer will notice and lose confidence; **P2** polish that helps at projector distance.

### 1. P0: The Engineering lens and the Engineering page blank the whole app
Screens: `review-lens-eng-home.png`, `review-engineering.png` (fully black).
Clicking the "Engineering" lens, or the "Engineering" nav item, throws React error #31 ("object with keys {runaway-loop, ping-pong, ...}"). `Fleet.tsx` line 109 and `Engineering.tsx` line 118 render `{det.cases}`, which is an object in the real impact.json and the number 60 in the fixture. There is no error boundary, so the app unmounts. Navigating to another hash does not recover it. The lens is saved in localStorage, so after one click, **every reload stays blank** until storage is cleared. On stage, that means a dead laptop in front of the room.
Fix: show `det.tp + det.fp + det.fn + det.tn` (18); add one error boundary per screen with a "Back to fleet" button; do not save the lens when the screen fails.

### 2. P0: Replay is empty in real mode, on every device
Screen: `review-replay-390.png` ("No recording yet. Nothing at /replay/events.json. Record a run with make replay.").
`/replay/events.json` returns the SPA's index.html (HTTP 200, text/html), so parsing fails. The server already serves the same file at `GET /v1/replay`. `make replay` calls `scripts/replay.ts`, which does not exist. Replay is the safety net if the live stack falls over on stage, and it is the page people will open on their phones.
Fix: fetch `/v1/replay` first (and `/v1/impact`), or serve `replay/` as static files; fix or remove the Makefile target and the empty-state text.

### 3. P1: The demo boots in a broken-looking state
Screens: `review-home.png`, `review-first-paint.png`.
A fresh server showed "11 of 12", "11 healthy 1 killed" and a red, dashed "Stopped" Invoice Reconciliation card before any drill, because the revocation persisted in `data/registry.json`. Within 2 seconds of first load, a toast appeared for a healthy agent ("cycle suspected"). The first impression is "something is already broken".
Fix: reset on boot in demo mode (or `make clean` in the pre-show checklist); suppress soft-alert toasts on the Executive lens and keep toasts for hard incidents.

### 4. P1: Too much moves at rest; incidents are not the only thing moving fast
Screens: compare the "What does it cost?" tile across `review-home.png` ($0.329), `review-agent-panel.png` ($0.367), `review-home-after-drill.png` ($0.30), `review-presenter-home.png` ($0.657), `review-focus.png` ($0.655).
The cost hero swings about 2x between screenshots taken seconds apart, with a count-up animation each time. The "decisions" counter climbs without stopping. The ticker scrolls a wall of green "Allowed" rows. Map edges pulse. With everything in motion, a real incident does not stand out.
Fix: on the Executive lens, show spend as a 5-minute rolling average updated every 10 s with no count-up; hide the ticker (or show only non-allow decisions); animate only state changes on the map.

### 5. P1: The fleet map is not readable at projector distance
Screens: `review-home.png`, `review-presenter-home.png`, `review-agent-panel.png`.
Agent card text is about 10 to 11 px, the spend per minute and "Healthy" labels about 8 to 9 px. Names are truncated ("Invoice Reconciliati...", "Support Case Summa...", "Regulatory Digest Age"), and the owner-initials badge overlaps the name. The minimap overlaps the Treasury Forecast card. The zoom controls and the bottom of the map are cut off at 900 px height, and the map needs internal scrolling. In presenter mode the cards get narrower, so truncation gets worse ("Credit Limits Chec", "Mortgage Docume").
Fix: on the Executive lens, default to agents only (hide data chips, collapse tools into a count), use 14 px minimum on cards, remove the minimap, and fit the map to the viewport on load. Keep the full graph for the Operations and Engineering lenses.

### 6. P1: Presenter mode is only "120% font", not a presenter mode
Screen: `review-presenter-home.png`.
It scales the root font to 120%. The top bar wraps to two rows, nothing is hidden, and the map gets more cramped. There is no visible "Reset" on home, no large "Run drill" button and no step indicator for a guided path (the Tour exists but is a separate mode with timed steps).
Fix: presenter mode should (a) hide the ticker, the command palette chip and the lens switch, (b) show hero tiles plus one big "Run runaway drill" button and a visible "Reset fleet", (c) use 1.5x type on tiles only, (d) show a small "Step 2 of 5" path that matches the Tour.

### 7. P1: The drill's best moment is below the fold, and there is dead air
Screens: `review-drill-during.png`, `review-drill-during2.png`, `review-drill-after.png`, `review-drill-after-full.png`.
The race charts and the "Stopped, and proven." card are excellent. But at 1440x900, steps 4 to 6 (Owner ack, Kill, Proof) are below the fold, so the presenter has to scroll at the climax. The ungoverned phase runs a full 12 s before the governed run starts; during that time the governed chart says "not run yet" and the steps say "waiting". When the governed run starts, "Elapsed 0.0 s" shows next to a step already marked "now". The Page step text wraps and doubles "(simulated) SIMULATED". The governed chart's x-axis runs to 12 s while all the action happens in the first 2.2 s, so the stop is a small blip.
Fix: run both phases at the same time (two lanes), or show a 3-2-1 countdown with a one-line narration ("Without controls: this agent keeps spending..."). Put the six steps in a compact horizontal strip above the charts. Auto-scroll to the proof card on `proof`. Crop the governed x-axis to about 4 s, or mark the stop point with a large label.

### 8. P1: Engineer language on executive surfaces
Screens: `review-home-after-drill.png` (banner), `review-home.png` (tiles), `review-verify-sheet.png`, `review-admission-reject.png`.
Examples: "Independent probe replayed llm.complete with the agent's old token: DENY (REVOKED), receipt gw-1:28323." (home banner); "until the probe is refused"; "p50 2.0 s ... slowest 2.2 s"; "over the A/B drill runs. 95 of 100 runs were this quick" (there were 20 runs, and that sentence is also wrong); "Rejected NO_LABEL". The Admission rejection body text itself is good plain English; the code chip next to it is fine for engineers.
Fix: on the Executive lens, banner text "Invoice Reconciliation Agent was stopped. We checked: it can no longer act. (receipt)"; tile note "average of 20 test runs"; keep codes in a smaller secondary line.

### 9. P2: Spend and value screen undersells and has chart bugs
Screen: `review-money.png`.
Amounts are shown to 3 decimals ($0.124, $0.003). The bar chart x-axis repeats "$0.01 $0.01 $0.01 $0.02 $0.02" and two value labels overlap ("$0.017" over "$0.018"). The line chart says "By model: not measured yet, run make stack" while the stack is running. "Value per day" is empty for every agent ("No assumption set"). For a CEO, the most important number on this page should be "a runaway costs about $210 an hour at these prices; the controls stopped it in 2 s", and it is not on the page.
Fix: fixed 2-decimal axis ticks with `minInterval`; hide value labels on bars when they collide; set default ASSUMPTION values for hours saved and hourly rate so the ledger shows something; add a "cost of one runaway hour" callout sourced from the drill.

### 10. P2: Accessibility and mobile details
Screens: `review-focus.png`, `review-home.png`, `review-replay-390.png`.
- Good: the focus ring is a clear 2 px amber outline (`review-focus.png`); agent states use an icon plus a word, not colour only; the state strip has a text summary; `prefers-reduced-motion` is respected in components I read.
- The filter chips "Alert 0", "Slowed 0", "Denied", "Slowed" are rendered at very low contrast. They are informational, but they look disabled and are hard to read on a projector.
- Map edges encode "in use" vs "idle" only by colour and brightness.
- Two similar buttons side by side ("Verify chain" and "Verify") in the "Can I prove it?" tile; first-time users will not know which to press.
- On a 390 px phone, the nav row is cut off mid-word ("Re...") with no fade or scroll cue; the page has no horizontal overflow (scrollWidth 390), which is good.
Fix: raise disabled-chip text to the `--color-muted` token; add dashed vs solid for edge state; rename the tile buttons to "Check the record" and "Where is this from?"; add an edge fade on the scrolling nav.

---

## Judged against the brief

| Criterion | Result |
|---|---|
| 5-second test | Narrow fail: no "AI", map dominates (see above) |
| One idea per screen | Drill, Admission, Registry: yes. Home: no; it has tiles, map, ticker, banner and toasts competing |
| Hierarchy: hero numbers, then fleet | Yes in layout; undermined by the map's visual weight and constant motion |
| Plain English | Tiles and Admission yes; banner, tile notes and Verify sheet no |
| Only incidents move fast | No: spend, counters, ticker and edges all move at rest |
| Accessibility | Focus, icon plus text states: good. Low-contrast chips, colour-only edges: fix |
| Arm's length / projector | Tiles yes; map and ticker no |
| Demo ergonomics | Drill button is large and clear and Reset is visible on Drill. Home has neither; presenter mode is weak; Tour exists |

---

## What is excellent. Do not touch.

- **The four questions as tile titles** (`review-home.png`). "What agents exist? / What does it cost? / Can I stop one, fast? / Can I prove it?" is the product's thesis in 14 words. Keep the wording.
- **The Drill theatre race and the "Stopped, and proven." card** (`review-drill-after.png`). Red ungoverned climb next to a flat governed line with "throttled" and "killed" markers, then a green card naming the denied call and its receipt. This is the moment people will remember. Fix the timing and the fold (issue 7), but keep the design.
- **The Verify sheet** (`review-verify-sheet.png`): every number opens a panel with what it means, its kind (measured or ASSUMPTION), its impact.json field, the run timestamp, the git sha and the command to reproduce it. This is the strongest trust feature in the product and rare in demos.
- **The Admission playground** (`review-admission-reject.png`): presets, a visible gate, and a rejection message a non-engineer understands ("carries no rollcall.dev/agent-id label, so it is not a registered agent. Register it in Roll Call first...").
- **Honesty labelling everywhere**: "measured" chips, "ASSUMPTION" chips, "(simulated)" on pager targets, "SIMULATED" on the owner ack, and the footer "Simulated fleet, real controls, every number from the last run, not affiliated with any bank". Keep all of it.
- **The agent panel** (`review-agent-panel.png`): purpose in one sentence, a big red "Stop this agent", then Now / What it can touch / Record. Good progressive disclosure.
- **The restrained dark palette and the amber focus colour.** Calm, legible, and the red and green carry meaning because there is little other colour.
