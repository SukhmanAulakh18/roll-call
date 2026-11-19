# ADR-002: Policy engine

Status: Accepted (spike, 2026-11-19)

## Context
Roll Call needs deterministic allow/deny evaluation per agent action, plus circuit-breaker, rate-limit and kill primitives, offline. Our code is TypeScript on Node 22.

## Options
1. Microsoft Agent Governance Toolkit (AGT) 4.1.0 (Python, MIT, "Public Preview").
2. OPA (Rego) as a sidecar binary or WASM. CNCF graduated, but its creators joined Apple in 2025, so treat long-term stewardship as a watch item.
3. Deterministic TypeScript evaluator behind a `PolicyEngine` interface.

## Decision
Option 3 now: `PolicyEngine.evaluate(ctx) -> {allow, reason, ruleId}`, with pure functions, no I/O and an audit trail per decision. OPA and AGT are adapters later (OPA via sidecar HTTP or WASM, AGT via a Python sidecar). This gives reproducible demos with no extra runtime and keeps the vendor choice open.

## Consequences
- We write and test our own rule set and circuit breaker (small, deterministic, easy to simulate).
- We do not get Rego/Cedar expressiveness until an adapter exists.
- AGT cannot be embedded in our Node process, so using it means a second runtime container.

## Evidence (what I ran)
- `pip download agent-governance-toolkit==4.1.0`: wheel is a thin meta-installer (agent_compliance CLI and lint tooling). The real code is in `agent-governance-toolkit-core` 4.1.0, which I downloaded and installed into a venv.
- Offline use works. With `python -I`, `from agent_os.policies.evaluator import PolicyEvaluator` imported once pyyaml and pydantic were installed (these are declared deps that pip did not pull in because I used `--no-deps`). Methods: `evaluate, load_policies, load_rego, load_cedar, add_backend`.
- Other primitives present: `CircuitBreaker` (`failure_threshold, recovery_timeout_seconds, half_open_max_calls`), `CascadeDetector`, token-bucket rate limiting, `policies/budget.py`, and `hypervisor/security/kill_switch.py` (KillSwitch).
- Python only (>=3.9), no TypeScript package found in the wheels. The import prints a deprecation warning for the old `agent_os` name. Classified "Development Status :: Beta / Public Preview". I did not execute policy decisions end to end.
- OPA was not installed or run in this spike. The comparison is from knowledge, not observation.
