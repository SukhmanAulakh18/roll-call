#!/usr/bin/env bash
# Fallback when kind cannot start pods (nested runc fails in some sandboxes): a REAL kube-apiserver
# v1.31.12 + etcd in Docker, no kubelet. Enough to exercise CRDs, ValidatingAdmissionPolicy and
# webhooks at admission time; pods/Deployments are stored but nothing schedules them.
# Images come from the kindest/node image (registry.k8s.io may be unreachable); see kind-up.sh.
set -euo pipefail
cd "$(dirname "$0")"; export PATH="/usr/local/bin:$PATH"
D=.tls/apiserver; mkdir -p $D
[ -f $D/sa.key ] || { openssl genrsa -out $D/sa.key 2048 2>/dev/null; openssl rsa -in $D/sa.key -pubout -out $D/sa.pub 2>/dev/null; }
echo "rollcall-dev-token,admin,admin,system:masters" > $D/tokens.csv
docker network inspect rollcall >/dev/null 2>&1 || docker network create rollcall >/dev/null
if ! docker image inspect registry.k8s.io/kube-apiserver:v1.31.12 >/dev/null 2>&1; then
  c=$(docker run -d --privileged --name rc-img kindest/node:v1.31.12); sleep 8
  for n in kube-apiserver etcd; do
    ref=$(docker exec $c ctr -n k8s.io images ls -q | grep "/$n:" | head -1)
    docker exec $c ctr -n k8s.io images export /root/$n.tar "$ref"; docker cp $c:/root/$n.tar $D/$n.tar; docker load -i $D/$n.tar
  done; docker rm -f $c >/dev/null
fi
docker inspect rollcall-etcd >/dev/null 2>&1 || docker run -d --name rollcall-etcd --network rollcall registry.k8s.io/etcd:3.5.15-0 \
  etcd --data-dir=/tmp/etcd --listen-client-urls=http://0.0.0.0:2379 --advertise-client-urls=http://rollcall-etcd:2379 >/dev/null
docker inspect rollcall-apiserver >/dev/null 2>&1 || docker run -d --name rollcall-apiserver --network rollcall -p 127.0.0.1:6443:6443 \
  -v "$PWD/$D:/keys:ro" registry.k8s.io/kube-apiserver:v1.31.12 kube-apiserver \
  --etcd-servers=http://rollcall-etcd:2379 --secure-port=6443 --bind-address=0.0.0.0 \
  --authorization-mode=AlwaysAllow --anonymous-auth=false --token-auth-file=/keys/tokens.csv --service-cluster-ip-range=10.96.0.0/16 \
  --service-account-issuer=https://rollcall.local --service-account-key-file=/keys/sa.pub \
  --service-account-signing-key-file=/keys/sa.key --disable-admission-plugins=ServiceAccount \
  --enable-admission-plugins=ValidatingAdmissionPolicy,ValidatingAdmissionWebhook >/dev/null
kubectl config set-cluster rollcall-apiserver --server=https://127.0.0.1:6443 --insecure-skip-tls-verify=true >/dev/null
kubectl config set-credentials rollcall-admin --token=rollcall-dev-token >/dev/null
kubectl config set-context kind-rollcall --cluster=rollcall-apiserver --user=rollcall-admin >/dev/null
kubectl config use-context kind-rollcall >/dev/null
until kubectl get --raw /readyz >/dev/null 2>&1; do sleep 2; done
