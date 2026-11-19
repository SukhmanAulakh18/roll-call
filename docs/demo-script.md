# Roll Call demo script

Everything runs offline on one laptop. Start it with `make demo` and open http://localhost:7100. Numbers on screen come from the live run or from impact.json. For the spoken numbers, see `print/pitch-numbers.md`; for the words, see `docs/pitch.md`.

## Before anyone walks in

1. Run `make demo`, then open http://localhost:7100.
2. Set the lens to **Executive** (top bar). The lens is saved in this browser, so check it after every reload.
3. Go to **Drill** and press **Reset fleet**. Revocations from an earlier run persist, so a used fleet shows a killed agent before you touch anything.
4. Check the home page: the agent count shows all registered agents running (`agents_running` in print/pitch-numbers.md), and there is no incident banner.
5. Turn presenter mode on with the presentation icon in the top bar (its label is "Presenter mode, larger type"). It enlarges the type for a projector. The icon is hidden on narrow screens, so use a laptop-width window.

## Between visitors: Reset fleet

1. Go to **Drill** and press **Reset fleet**. It is disabled while a drill runs, so wait for the run to finish.
2. Go back to **Fleet** (home) and confirm the count matches `agents_registered` in print/pitch-numbers.md and no banner is showing.
3. If the lens changed, set it back to **Executive**.

## The 40-second path

Use the Executive lens. Each step names the on-screen control.

| Time | Click path | Say (see docs/pitch.md) |
|---|---|---|
| 0:00 to 0:05 | **Fleet** (home). The sentence at the top of the page is on screen. | Read it aloud: "Roll Call watches a bank's AI agents (software workers) and can stop one that goes wrong, with proof." The fleet is simulated. |
| 0:05 to 0:13 | Point left to right at the four tiles: **What agents exist?**, **What does it cost?**, **Can I stop one, fast?**, **Can I prove it?** | "What agents exist, what it costs, can I stop one, and can I prove it." |
| 0:13 to 0:16 | Press **Run a drill**. It opens **Drill** and starts the runaway-loop race. | "Same fault, with and without controls." |
| 0:16 to 0:28 | Watch the two race charts and the steps: **Detect**, **Throttle**, **Page**, **Owner ack**, **Kill**, **Proof**. Wait for **Proof** to show the probe refused. | "Detect, throttle, page, kill, proof. The owner acknowledgement is simulated (`owner_ack_simulated`)." |
| 0:28 to 0:33 | Go back to **Fleet**. On the **Can I stop one, fast?** tile, press **Verify**. | Point at the field, the last-run time and the command that reproduces it. "Every number has a source." |
| 0:33 to 0:40 | Close the sheet. Press **Admission** in the navigation (the page is titled **Admission playground**). Keep the preset **Unregistered shadow-bot** and press **Try to deploy**. | "Rejected at the gate, with a reason. Nothing unregistered runs." |

If the drill does not reach **Proof** within about 15 seconds, say so and move on. Do not wait on the screen.

Hands-free alternative: **Tour** in the top bar plays the same path in five steps (about 40 seconds: four questions, Verify, runaway drill, proof, admission). Arrow keys step, **p** pauses, Escape ends it.

## The 3-minute version

Start with the 40-second path. Then continue:

| Time | Click path | Say |
|---|---|---|
| 0:40 to 1:10 | Switch the lens to **Operations**. Point at the map: agents, tools, and the live links. Press **Run agent ping-pong** from the command palette (Ctrl or Cmd+K). | "Two agents call each other. The loop lights up. Be ready for the collateral: in this test it hit the other agent every run." |
| 1:10 to 1:40 | **Drill**: when the ping-pong run ends, press **Replay the race side by side** if it is offered. For the runaway run, read the spend line under the chart. | "Spend kept out at assumed prices. The prices are assumptions." |
| 1:40 to 2:10 | Switch the lens to **Engineering**, or open **Engineering** in the navigation. Press **Verify** on the overhead or detector tile. | "Overhead is an end-to-end difference, on one laptop, with no TLS. Detector figures are hard containment on small runs." |
| 2:10 to 2:35 | **Spend and value** shows the budgets per agent. **Registry** shows owners, scopes and risk ratings. Owner names are fictional. | "Budgets are enforced at the gateway on every call. Owners are fictional." |
| 2:35 to 3:00 | **Fleet**. Close with the first four honest limits from `docs/pitch.md`, then the 30/60/90-day pilot. | "The fleet is simulated, the controls are real. Here is what a pilot would look like." |

Optional, if someone asks about releases: on **Drill**, pick **Bad release** and press **Run bad release**. The **Promotion gates** panel fails the canary and it is rolled back with no human. Its measured time is `release.timeToRollbackMs` in impact.json; say it is one simulated fault kind on one agent. **Good release** is the control case and is promoted. Each run takes several seconds, so do not use it in the 40-second path.

Check **Engineering** and **Replay** on the rehearsal build before the demo. An earlier review found those screens failed in real mode; both were fixed (see `exec-pack/exec-review.md`), but check anyway. If either is broken, skip it and say nothing about it.

## If the Wi-Fi is down

Everything in the demo runs locally, so the path works with no network if `make demo` is already running.

- Keep the laptop running `make demo`. If the screen shows stale state, press **Reset fleet** rather than restarting.
- Do not open the GitHub Pages Replay link or the repository QR code. Both need the internet.
- For the offline Replay, open http://localhost:7100/#/replay. Rehearse it first. If it is empty on the rehearsal build, do not use it.
- If the live stack fails on stage, play the 60-second fallback video (recorded with OS screen capture, saved locally and on a USB stick). Narrate over it with the 40-second script.
- If the screen goes blank, reload once. If it is still blank, switch to the fallback video. Do not debug on stage.

## Friday-morning checklist

Target: a presenter can go from a fresh clone to a running demo in under 10 minutes.

- [ ] Clone the repository into an empty folder. Run `npm ci`, then `(cd ui && npm ci)`, and confirm both finish without errors. (`qrcode` is pinned in devDependencies.)
- [ ] Optional: run `make drill`. If you run it, run `make print` afterwards so the leave-behind and `print/pitch-numbers.md` match the new `impact.json`.
- [ ] Run `make demo`. Time it from the clone step to the first page at http://localhost:7100. It must finish in under 10 minutes.
- [ ] Offline test: turn Wi-Fi off, reload http://localhost:7100, and walk the 40-second path. Check Verify, Admission and Reset fleet. Turn Wi-Fi back on.
- [ ] Charge the laptop, plug it in, and disable sleep and notifications.
- [ ] Print the leave-behind: run `make print`, then print `print/leave-behind.pdf` at A5, one page, no scaling. Check that both QR codes scan from a phone at printed size.
- [ ] Record a 60-second fallback video with OS screen capture. Narrate the 40-second path over it. Keep a copy locally and on a USB stick.
- [ ] Rehearse the 40-second path twice, with a timer. Both runs must finish in under 40 seconds.
- [ ] Rehearse the 3-minute path once, with a timer. It must finish in under 3 minutes.
- [ ] Set the lens to **Executive**, turn presenter mode on, and press **Reset fleet** just before going on stage.
