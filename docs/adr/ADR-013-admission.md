# ADR-013: Two-layer Kubernetes admission

Status: accepted

## Decision
Workloads in namespaces labeled `rollcall.dev/governed=true` pass two admission layers.

1. **Native ValidatingAdmissionPolicy** (`deploy/k8s/policies.yaml`). Denies any Deployment or Pod without a non-empty `rollcall.dev/agent-id` label, with a plain-English message. It runs inside the API server, so it has no network dependency and no extra moving part. This is the floor: an unlabeled agent can never start.
2. **ValidatingWebhookConfiguration** (`deploy/k8s/webhook.yaml`) calling control `POST /v1/admission/review` (AdmissionReview v1). Does the record lookup `admit()` implements: record exists, owner and scopes present, not retired, canary/production have passing evaluation. `failurePolicy: Fail`.

Why two: a label is cheap to forge but cheap to check offline; a record lookup needs the control plane. The label check keeps working when control is down, and the webhook adds the evidence check.

## Fail closed
`failurePolicy: Fail` means no new governed admissions while control is unreachable. This matches static stability (ADR-004): already-running agents and the gateway's cached bundle keep working; only new admissions wait. The `AgentRecord` CRD also enforces the same rules (CEL) at write time.

## Running it
- `kind-up.sh` makes a self-signed CA and cert (openssl, `deploy/k8s/.tls`, gitignored) for `rollcall-control.rollcall-system.svc`. Control runs in-cluster as `node:22.12-alpine` with the repo mounted via kind `extraMounts`; an nginx sidecar terminates TLS because control speaks plain HTTP. The webhook is applied only after control is Ready, because a dead backend plus `Fail` would block every governed admission.
- Sandbox caveat: in the build sandbox kind nodes cannot start pods (nested runc fails), so `apiserver-up.sh` runs a real kube-apiserver 1.31 plus etcd in Docker. That is enough to prove CRD and VAP behaviour; the webhook layer needs a cluster with nodes.
