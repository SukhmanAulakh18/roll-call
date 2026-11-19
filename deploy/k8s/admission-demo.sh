#!/usr/bin/env bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:$PATH"
kubectl -n roll-call-demo delete deploy fraud-triage shadow-bot --ignore-not-found >/dev/null
echo "== 1. Registered agent (label rollcall.dev/agent-id=fraud-triage) =="
kubectl apply -f samples/agent-fraud-triage.yaml && echo "ALLOWED"
echo
echo "== 2. Unregistered shadow-bot (no label) =="
if out=$(kubectl apply -f samples/shadow-bot.yaml 2>&1); then echo "UNEXPECTEDLY ALLOWED"; else echo "REJECTED:"; echo "$out"; fi
echo
echo "== Deployments in roll-call-demo =="
kubectl -n roll-call-demo get deploy
echo "== AgentRecords =="
kubectl -n roll-call-demo get ar
