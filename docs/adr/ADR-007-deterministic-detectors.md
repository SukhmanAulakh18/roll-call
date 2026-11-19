# ADR-007: Deterministic detectors with a two-signal rule and no model in the loop

Status: Accepted (design)

## Context
Agents can run away: a loop repeats the same tool call, two agents call each other in a cycle, or an agent starts using tools outside its scope. The control loop must notice this quickly and act in proportion. Using a language model to judge whether an agent is misbehaving would add latency, cost and a new failure mode, and its decisions would be hard to replay and explain to an auditor.

## Options
1. A model-based anomaly detector that reads the event stream and recommends action.
2. Fixed thresholds on absolute rates. Simple, but a busy but healthy agent is treated like a broken one.
3. Deterministic detectors with two independent signals, each compared against the agent's own history.

## Decision
Option 3. The detector is pure code with no randomness and no model call.
- Signal 1, rate: the call rate in the window compared against the agent's own robust baseline (median of prior windows). A ratio above the threshold is a signal.
- Signal 2, repetition: the same tool and argument hash repeated beyond a count, or an agent-to-agent (A2A) cycle in the `targetAgentId` graph. Scope drift (a call outside the agent's scopes) is also reported as a finding.
- Response, by signal count:
  - One signal: soft throttle and an alert to the owner.
  - Two signals: hard throttle and a page to the owner's escalation target.
  - Policy breach or owner decision: kill (ADR-006).

Detector results are scored against labelled drills as true positive, false positive, false negative and true negative (the `detector` section of impact.json).

## Consequences
- Given the same events, the detector always gives the same answer, so incidents can be replayed and explained.
- The two-signal rule trades speed for precision: a single runaway signal only throttles. A slow runaway that repeats without a rate spike can be caught as soft only (the `slow-repeat` drill).
- Baselines need enough history. A new agent has no baseline and relies on the repeat signal and the scope rule until it has one.
- Thresholds are configuration. Changing them is a policy change and goes through the bundle like any other.
- Detector precision and recall are measured, not claimed: see impact.json (`make drill`).
