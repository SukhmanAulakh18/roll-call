# Design-partner interview kit (15 minutes)

Goal: talk to 3–5 AI platform engineers or AI risk people, learn their real operational pain, and have them critique Roll Call's controls. One honest design partner beats ten new features.

Rules: public information only; don't ask about anything confidential; don't quote anyone or name their employer without written permission. Notes go in the table at the bottom, anonymised (role + company size only).

## Opening (1 min)
"I'm building a control layer for AI agents that can take actions. I'm not selling anything. I'd like to understand how you handle this today, and then get your honest critique of a demo."

## Their world (6 min)
1. Are any agents in your org allowed to take actions (call tools, write data, spend money) rather than just answer questions? Roughly how many?
2. How do you know today which agents exist and who owns each one?
3. What is the worst thing an agent could do in your environment? Has anything close to that happened?
4. If an agent misbehaved right now, how would you find out, and how would you stop it? How long would that take?
5. Who has to sign off before an agent gets new permissions or goes to production?
6. What would make you trust a "stopped" status — what evidence would you need?

## The demo (4 min)
Show: the story page, then Drill → Run runaway loop, then the external refund agent being blocked over its limit and denied after the kill.

## Critique (4 min)
7. What would stop you from using this? (integration effort, latency, trust, cost, politics)
8. Which control matters most to you: inventory, budget limits, kill with proof, audit evidence, release gates?
9. What's missing or wrong?
10. Who in your organisation would pay for something like this, and what would it replace?
11. Would you look at a revised version in a few weeks? (design partner ask)

## Notes

| # | Role | Org size | Agents in prod? | Top pain (their words, paraphrased) | Most valued control | Biggest objection | Follow-up? |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |

## What changed because of these interviews
(Fill in after: each change → which interview drove it.)
