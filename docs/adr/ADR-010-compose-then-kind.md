# ADR-010: Compose first, then kind

Status: Accepted (design)

## Context
The project has to run on a laptop with no cluster, no cloud account and no network. It also has to show the production shape: admission control, CRDs, rollouts and separate services. Starting with Kubernetes would make the first run slow and hard to debug. Starting only with in-process code would hide the service boundaries that matter.

## Options
1. Kubernetes (kind) from the start.
2. Docker Compose with one container per role, then kind for the Kubernetes path.
3. In-process only (`make stack`), no containers.

## Decision
Option 2, with option 3 kept for development. `make stack` runs control, gateway, tools and fleet in one Node process for fast tests. `make compose-up` runs the same roles as separate containers, which shows the service boundaries and the network between them. `make kind-up` adds the AgentRecord CRD and the admission webhook, which is the production shape. Each step must pass the same acceptance tests before the next one is considered done.

## Consequences
- Compose has two gateway replicas, so replica loss and per-replica receipt chains can be shown on a laptop.
- Compose is not a production topology. It has no admission control and no real identity attestation.
- Two sets of manifests exist (compose and Kubernetes). Keeping the roles and environment names the same across both is a rule for reviews.
- Compose validation is a syntax check in this repository (`docker compose config`). Running the stack is a separate step.
