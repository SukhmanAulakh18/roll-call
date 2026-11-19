# CI

Workflows live in `.github/workflows/`. Every third-party action is pinned to a full commit SHA with the version in a comment. Each job declares its own least-privilege `permissions:`, and a newer run on the same ref cancels the older one.

## `ci.yml` (push and pull request on `main`)

| Job | Steps | What it proves |
|---|---|---|
| `check` | `npm ci`, `npm run typecheck`, `npm test`, `npm run test:acceptance`, then in `ui/`: `npm ci`, `tsc --noEmit`, `npm run lint`, `npm run build` | Backend and UI type-check under strict settings, unit tests pass, the Definition-of-Done acceptance tests pass, the UI lints and builds. |
| `supply-chain` | Build `deploy/compose/Dockerfile` (loaded locally, not pushed); SBOM; Trivy; gitleaks | The image builds. An SPDX SBOM exists for it (uploaded as an artifact). No CRITICAL vulnerabilities in the source tree or image. No committed secrets. |
| `sign` (push to `main` only) | Push to `ghcr.io/<owner>/<repo>` (lowercased), cosign keyless sign, cosign SBOM attestation, build provenance attestation | The published image digest is signed by this workflow's identity, carries its SBOM, and has SLSA-style provenance. |

Notes:

- `test:acceptance` DoD2 and DoD5 read the committed `impact.json`. CI does not regenerate it, so those tests check the committed numbers, not a fresh run.
- Trivy runs twice per target: once reporting CRITICAL and HIGH to SARIF (uploaded to code scanning, never blocking), once gating on CRITICAL only (exit code 1).
- gitleaks-action needs `GITLEAKS_LICENSE` only for organization repositories. If this repo moves to an organization, add that secret.
- Code scanning upload needs GitHub code scanning to be available (public repo, or GitHub Advanced Security on a private one).

## `red-team.yml` ("drill regression"; manual dispatch and weekly)

Runs `node scripts/drill.ts --runs 3 --no-write` (so the committed `impact.json` is untouched), then fails if detector precision or recall is not 1, if any governed run was not contained, or if p95 time-to-contain exceeds its budget. It is offline: simulated agents and fault injection, no hosted model. It takes several minutes, which is why it is not on every push.

## Mapping to the build brief's CI line

| Brief stage | Where |
|---|---|
| lint / type | `check`: `npm run typecheck`; UI `tsc` and `eslint` |
| unit | `check`: `npm test` |
| policy / detector tests | `check`: `npm test` and `test:acceptance` (whatever exists under `services/`, `sim/`, `tests/`); no separate property-test suite yet |
| contract tests | `check`: acceptance tests exercise the contracts; no standalone contract job |
| red-team regression | `red-team.yml` |
| build | `check` (UI build), `supply-chain` (image build) |
| SBOM | `supply-chain`, again for the pushed image in `sign` |
| scan | `supply-chain`: Trivy fs and image |
| secrets | `supply-chain`: gitleaks |
| sign | `sign`: cosign keyless |
| provenance | `sign`: `actions/attest-build-provenance` |

## Not done

- Manifest pull request and Argo CD sync: nothing here updates deployment manifests or deploys. The pipeline stops at a signed, attested image.
- promptfoo, garak and PyRIT: they need a model to attack or judge. The drill regression is the offline substitute and does not cover prompt-level attacks.
- Signature and attestation verification at admission (for example a cosign policy in the kind cluster) is not wired up.
- Dependency review and `npm audit` on the UI are covered only through Trivy's filesystem scan.
- Workflows could not be run on GitHub from here. They were checked with actionlint, and the `check` commands were run locally.
