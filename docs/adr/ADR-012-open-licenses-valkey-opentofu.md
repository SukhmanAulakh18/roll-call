# ADR-012: Valkey over Redis and OpenTofu over Terraform, for license hygiene

Status: Accepted (design). Licenses must be verified before adoption.

## Context
Roll Call is a reference for a regulated environment, and the bank-facing parts of it will be reviewed for licensing. Two infrastructure choices have licensing questions: the in-memory store (Redis or Valkey) and the infrastructure-as-code tool (Terraform or OpenTofu). Licence terms change over time, so the decision has to be re-checked, not assumed.

## Options
1. Redis for the store and Terraform for infrastructure as code, as many teams already use.
2. Valkey for the store and OpenTofu for infrastructure as code, both community-governed forks with open-source licences.
3. Defer the choice and keep the code behind an interface.

## Decision
Option 2, with option 3 as the code structure. The compose file uses `valkey/valkey:8.1-alpine`. Infrastructure code, if any is added, is written for OpenTofu. Application code talks to the store through a small interface, so the choice can change without rewriting the services.

Before adoption, each dependency's current licence, its maintainers and its release policy must be checked and recorded in the README licence table. This ADR records a choice made on the basis of the licences as understood at writing time. It is not a legal opinion.

## Consequences
- A licence check is a required step before each new dependency is added, and before each major version change.
- Tooling and documentation must say OpenTofu where infrastructure code is mentioned, so reviewers are not confused.
- Some managed services and documentation examples assume Redis or Terraform. We adapt them and note the change.
- The choice has a maintenance cost: forks can diverge from upstream. We track their release notes.
