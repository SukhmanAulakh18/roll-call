# Availability model

This document describes the method. It contains no measured values. Targets are design goals and are labelled as targets. Measured results are added from `make chaos` in the section at the end.

## Scope
Two availability targets:
- Data plane (gateways serving agent calls): target 99.95%.
- Control plane (registry, issuer, policy, incidents, admission, kill): target 99.9%.

## Downtime budget implied by the targets
These are arithmetic from the targets over a 30-day month, not measurements.

| Target | Allowed unavailability per 30 days |
|---|---|
| 99.95% (data plane target) | 21.6 min |
| 99.9% (control plane target) | 43.2 min |

## Method

Let each component `i` have an availability `aᵢ`, the fraction of time it is up.

### Serial dependencies
A call succeeds only if every component on its path is up:

  A_serial = ∏ aᵢ

Example: if the gateway, policy cache and receipt writer were each a serial dependency, the product of their availabilities is the path availability. Serial composition always lowers availability, so each extra hard dependency on the call path costs availability.

### Redundant replicas
If `n` replicas each have availability `a` and fail independently, the service is up when at least one replica is up:

  A_replicas = 1 − ∏ (1 − aᵢ)

For identical replicas, A = 1 − (1 − a)ⁿ.

### Shared fate caps the benefit
The replica formula assumes independent failures. Replicas that share a dependency (the same node pool, the same identity issuer, the same policy bundle source, the same store) fail together for that dependency's outages. If the shared dependency is on every path and has availability `s`, and it is independent of the replicas, then:

  A = s × (1 − ∏(1 − aᵢ))

Adding gateway replicas raises the second factor but never raises A above `s`. This is why static stability (ADR-004) matters: a cached bundle removes the control plane from the data-plane path for most calls, so the shared dependency is no longer on those paths.

### Identity issuer as a hard dependency for renewals
Renewals need the issuer, but an agent with a valid token keeps working until that token expires. So the issuer is a hard dependency for renewals and for new identities, not for every call. The model treats an issuer outage as a question of duration against the token TTL:
- An outage shorter than the remaining token life does not stop an agent.
- An outage longer than the TTL stops every agent that depends on renewal.

The TTL is therefore an availability parameter as well as a security one (ADR-005). Shortening it tightens revocation and makes the fleet more sensitive to issuer outages.

### Calculating targets against measurements
Measured per-component availability replaces the `aᵢ` values above, once `make chaos` has run. Until then, the formulas describe structure only.

### Data plane and control plane are different targets
- Data plane calls need: gateway replica (at least one), a fresh-enough bundle for high-risk tools, and a valid token.
- Control plane calls need: control service and its store.

Data plane availability is not the product of control plane availability, because cached policy removes control from most data-plane calls. The model computes the two separately.

## Inputs to fill in (after measurement)
- Per-component availability from chaos runs: the fraction of time each component was up during the game day.
- Shared dependency availability: the identity issuer and bundle source.
- Replica count in the deployed topology.

No values are assumed here.

## Measured (from `make chaos`)

pending `make chaos`

When the run finishes, read the figures from impact.json (not from this document) and record the run date, the commit, and the topology used.
