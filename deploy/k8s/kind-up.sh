#!/usr/bin/env bash
# Idempotent: kind + kubectl, cluster "rollcall", CRD, samples, VAP, control plane, webhook.
set -euo pipefail
cd "$(dirname "$0")"
REPO=$(cd ../.. && pwd)
CLUSTER=rollcall
NODE_IMAGE=kindest/node:v1.31.12
BIN=${BIN:-/usr/local/bin}
export PATH="$BIN:$PATH"

command -v kind >/dev/null || GOBIN=$BIN go install sigs.k8s.io/kind@v0.30.0
command -v kubectl >/dev/null || { curl -fsSL -o "$BIN/kubectl" https://dl.k8s.io/release/v1.34.0/bin/linux/amd64/kubectl && chmod +x "$BIN/kubectl"; }

if kind get clusters 2>/dev/null | grep -qx $CLUSTER; then
  kubectl config use-context kind-$CLUSTER >/dev/null
elif docker inspect rollcall-apiserver >/dev/null 2>&1; then
  ./apiserver-up.sh
else
  if ! { cat <<YAML | kind create cluster --name $CLUSTER --image $NODE_IMAGE --config -
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraMounts:
      - {hostPath: $REPO, containerPath: /repo, readOnly: true}
YAML
  } >/dev/null 2>&1; then
    echo "kind cannot start pods here (nested runc); falling back to bare kube-apiserver+etcd (apiserver-up.sh)"
    kind delete cluster --name $CLUSTER >/dev/null 2>&1 || true
    ./apiserver-up.sh
  fi
fi

# Self-signed CA + serving cert for the webhook Service (kept in .tls/, gitignored)
mkdir -p .tls && printf '*\n' > .tls/.gitignore
SAN=rollcall-control.rollcall-system.svc
if [ ! -f .tls/tls.crt ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=rollcall-ca" -keyout .tls/ca.key -out .tls/ca.crt 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$SAN" -keyout .tls/tls.key -out .tls/tls.csr 2>/dev/null
  openssl x509 -req -in .tls/tls.csr -CA .tls/ca.crt -CAkey .tls/ca.key -CAcreateserial -days 365 \
    -extfile <(printf "subjectAltName=DNS:%s,DNS:rollcall-control.rollcall-system.svc.cluster.local" "$SAN") -out .tls/tls.crt 2>/dev/null
fi

kubectl apply -f agentrecord-crd.yaml
kubectl wait --for=condition=Established crd/agentrecords.rollcall.dev --timeout=60s
kubectl apply -f policies.yaml
kubectl apply -f samples/agentrecord-fraud-triage.yaml -f samples/agentrecord-kyc-refresh.yaml -f samples/agentrecord-invoice-recon.yaml

# Control plane (in-cluster, repo mounted) + webhook. The webhook is wired only once the control
# plane answers: with failurePolicy Fail a dead backend would block every governed admission.
kubectl delete -f webhook.yaml --ignore-not-found >/dev/null 2>&1 || true
if [ -f "$REPO/services/control/src/app.ts" ] && [ -n "$(kubectl get nodes -o name)" ]; then
  kubectl apply -f control.yaml
  kubectl -n rollcall-system create secret tls rollcall-webhook-tls --cert=.tls/tls.crt --key=.tls/tls.key \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n rollcall-system rollout restart deploy/rollcall-control >/dev/null
  kubectl -n rollcall-system rollout status deploy/rollcall-control --timeout=180s
  sed "s|__CA_BUNDLE__|$(base64 -w0 .tls/ca.crt)|" webhook.yaml | kubectl apply -f -
  echo "webhook: ACTIVE"
else
  echo "webhook: PENDING (needs services/control/src/app.ts AND a cluster with nodes; this sandbox only ran bare apiserver)"
fi
echo "kind-up done. Next: ./admission-demo.sh"
