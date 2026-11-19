import type { AdmissionResult, AgentRecord, WorkloadSpec } from '../../../contracts/types.ts';

export const AGENT_LABEL = 'rollcall.dev/agent-id';
const deny = (code: string, reason: string): AdmissionResult => ({ allowed: false, code, reason });

/** Validation shared by admission and POST /v1/agents. */
export function checkRecord(r: AgentRecord): AdmissionResult {
  if (!r.owner?.name || !r.owner?.escalation) return deny('NO_OWNER', `Agent '${r.id}' has no accountable owner and escalation contact. Add them to its record.`);
  if (!r.scopes?.tools?.length) return deny('NO_SCOPES', `Agent '${r.id}' declares no tool scopes, so it could not do anything governable. Declare the tools it may call.`);
  if (r.lifecycleState === 'retired') return deny('RETIRED', `Agent '${r.id}' is retired and may not run. Re-register a new version instead.`);
  if ((r.lifecycleState === 'production' || r.lifecycleState === 'canary') && !r.evaluation?.passed)
    return deny('NO_PASSING_EVAL', `Agent '${r.id}' is in ${r.lifecycleState} but has no passing evaluation on record. Attach passing evidence or move it back to shadow.`);
  return { allowed: true, code: 'OK', reason: `Agent '${r.id}' is registered, owned by ${r.owner.name}, lifecycle ${r.lifecycleState}.` };
}

export function admit(w: WorkloadSpec, records: AgentRecord[]): AdmissionResult {
  const id = w.labels?.[AGENT_LABEL];
  if (!id) return deny('NO_LABEL', `Workload '${w.name}' carries no ${AGENT_LABEL} label, so it is not a registered agent. Register it in Roll Call first, then label the workload.`);
  const rec = records.find(r => r.id === id);
  if (!rec) return deny('NOT_REGISTERED', `No agent record '${id}' exists. Register the agent before deploying workload '${w.name}'.`);
  return checkRecord(rec);
}

/** Accepts {workload} or a k8s AdmissionReview v1 and answers in kind. */
export function review(body: any, records: AgentRecord[]): { out: any; workload: string; result: AdmissionResult } {
  if (body?.kind === 'AdmissionReview' && body.request) {
    const o = body.request.object ?? {}, m = o.metadata ?? {};
    const name = m.name || m.generateName || body.request.name || 'unnamed';
    const result = admit({ name, namespace: body.request.namespace ?? m.namespace ?? 'default', labels: m.labels ?? {} }, records);
    return { workload: name, result, out: { apiVersion: 'admission.k8s.io/v1', kind: 'AdmissionReview', response: { uid: body.request.uid, allowed: result.allowed, status: { code: result.allowed ? 200 : 403, message: result.reason } } } };
  }
  const w = body?.workload ?? body;
  const result = admit({ name: w?.name ?? 'unnamed', namespace: w?.namespace ?? 'default', labels: w?.labels ?? {} }, records);
  return { workload: w?.name ?? 'unnamed', result, out: result };
}
