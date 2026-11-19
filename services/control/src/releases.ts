import type { AgentRecord, GateCheck, IncidentEvent, IncidentStage, LifecycleState, PolicyBundle, PromotionEvidence, PromotionResult, Release, StreamMessage } from '../../../contracts/types.ts';
import { sleep } from '../../lib/http.ts';
import { POLICY, evaluatePromotion, statsOf } from './lifecycle.ts';
import type { Engine } from './engine.ts';
import type { Registry } from './registry.ts';
import type { FleetControl } from './runtime.ts';

export interface ReleaseDeps {
  registry: Registry; engine: Pick<Engine, 'eventsBetween'>; clock: () => number; publish: (m: StreamMessage) => void;
  runtime: () => FleetControl | undefined;
  acks: () => Record<string, { version: number; ts: number }>;   // bundle version each gateway last reported
  impact: () => any | null;                                      // parsed impact.json, or null when absent
}

/** "invoice-recon@1.1.0" -> "invoice-recon". A canary variant acts under its own identity so gateway events tell the two versions apart. */
export const baseOf = (id: string): string => id.split('@')[0];
const bumpMinor = (v: string): string => { const [a = '1', b = '0'] = v.split('.'); return `${a}.${Number(b) + 1}.0`; };

/** Promotion with evidence from control's own measurements, plus the canary release controller (ADR-014). */
export function createReleases(d: ReleaseDeps) {
  const all: Release[] = [];
  const log: IncidentEvent[] = [];
  const settling = new Set<string>();
  let seq = 0;
  const active = () => all.filter(r => r.state === 'canary');

  const emit = (r: Release, stage: IncidentStage, message: string): IncidentEvent => {
    const ev: IncidentEvent = { incidentId: r.id, agentId: r.agentId, stage, ts: d.clock(), message };
    log.push(ev); d.publish({ type: 'incident', data: ev });
    return ev;
  };

  function evidence(agentId: string, to: LifecycleState, rel?: Release): PromotionEvidence {
    const now = d.clock(), imp = d.impact();
    const t = imp?.drill?.timeToContainMs, det = imp?.detector;
    const own = (from: number, until: number) => statsOf(d.engine.eventsBetween(from, until, agentId));
    const w = POLICY.canaryWindowMs;
    const canary: PromotionEvidence['canary'] = rel
      ? { candidate: statsOf(d.engine.eventsBetween(rel.startedAt, now, rel.variantId)), baseline: own(rel.startedAt, now) }
      : to === 'production' ? { candidate: own(now - w, now), baseline: own(now - 2 * w, now - w) } : null; // no release: the agent's last window against the one before it
    const b = own(0, now);
    return {
      to, now, canary, budget: { calls: b.calls, errors: b.errors },
      drills: t && imp.drill.budgetsMs ? { uncontained: t.uncontained ?? 0, containP95Ms: t.p95, containBudgetMs: imp.drill.budgetsMs.containP95 } : null,
      attackSuite: det && Number.isInteger(det.tp) && Number.isInteger(det.fn) ? { positives: det.tp + det.fn, missed: det.fn } : null,
    };
  }

  async function stopRuntime(r: Release): Promise<void> { await d.runtime()?.stopCanary(r.variantId); }

  async function promote(agentId: string, to: LifecycleState, dryRun = false): Promise<PromotionResult> {
    const rec = d.registry.get(agentId); if (!rec) throw new Error(`no agent '${agentId}'`);
    const res = evaluatePromotion(rec, evidence(agentId, to, active().find(r => r.agentId === agentId)));
    if (dryRun || !res.allowed) return { ...res, dryRun };
    const next: AgentRecord = { ...rec, lifecycleState: to };
    d.registry.upsert(next);
    if (to === 'retired') { for (const r of active().filter(x => x.agentId === agentId)) await abort(r, 'the agent was retired'); await d.runtime()?.stop(agentId); }
    return { ...res, dryRun, record: next };
  }

  /** A version bump as a canary: the new version takes POLICY.canaryShare of the agent's traffic under its own identity. */
  async function start(agentId: string, o: { version?: string; fault?: 'errors' } = {}): Promise<Release> {
    const rec = d.registry.get(agentId), rt = d.runtime();
    if (!rec) throw new Error(`no agent '${agentId}'`);
    if (!rt) throw new Error('no runtime attached, so there is nothing to run a canary on');
    if (rec.lifecycleState !== 'production' && rec.lifecycleState !== 'canary') throw new Error(`'${agentId}' is ${rec.lifecycleState}; only a production or canary agent can run a new version as a canary`);
    if (active().some(r => r.agentId === agentId)) throw new Error(`'${agentId}' already has a canary running`);
    const version = o.version ?? bumpMinor(rec.version);
    if (version === rec.version) throw new Error(`version ${version} is already the stable version`);
    const r: Release = { id: `REL-${d.clock().toString(36)}-${++seq}`, agentId, variantId: `${agentId}@${version}`, stableVersion: rec.version, candidateVersion: version, share: POLICY.canaryShare, startedAt: d.clock(), state: 'canary' };
    all.push(r);
    d.registry.upsert(rec);                                       // bumps the bundle version so gateways learn the variant identity
    const want = d.registry.version();
    for (let i = 0; i < 80; i++) { const live = Object.values(d.acks()).filter(a => d.clock() - a.ts < 3000); if (live.length && live.every(a => a.version >= want)) break; await sleep(25); }
    try { await rt.startCanary(agentId, r.variantId, r.share, o.fault); }
    catch (e) { r.state = 'rolled_back'; throw e; }
    r.startedAt = d.clock();
    emit(r, 'canary_started', `Canary started: v${version} takes ${Math.round(r.share * 100)}% of ${agentId}'s traffic; v${rec.version} stays stable. Judged on error rate and p99 against stable after at least ${POLICY.canaryMinCalls} decisions.`);
    return r;
  }

  async function rollBack(r: Release, res: PromotionResult): Promise<void> {
    emit(r, 'detected', `Canary analysis failed: ${res.checks.filter(c => !c.passed).map(c => c.detail).join('; ')}.`);
    await stopRuntime(r);
    r.state = 'rolled_back'; r.endedAt = d.clock(); r.result = res;
    const rec = d.registry.get(r.agentId); if (rec) d.registry.upsert(rec);    // bundle drops the variant
    emit(r, 'rolled_back', `Rolled back automatically: canary v${r.candidateVersion} stopped, all traffic back on v${r.stableVersion}. The record stays at v${r.stableVersion}.`);
  }

  async function abort(r: Release, why: string): Promise<void> {
    const c: GateCheck = { name: 'Agent status', passed: false, detail: why };
    await rollBack(r, { allowed: false, reason: `Blocked: ${why}`, checks: [c], from: 'canary', to: 'production' });
  }

  async function promoteRelease(r: Release, res: PromotionResult): Promise<void> {
    const rec = d.registry.get(r.agentId)!;
    d.registry.upsert({ ...rec, version: r.candidateVersion });
    await stopRuntime(r);
    r.state = 'promoted'; r.endedAt = d.clock(); r.result = res;
    emit(r, 'promoted', `Promoted automatically: v${r.candidateVersion} passed all ${res.checks.length} gates and is now the production version of ${r.agentId}.`);
  }

  /** Called on the control tick. The verdict is evaluatePromotion on measured events: a bad canary fails as soon as enough decisions are in; a good one is promoted after the window. */
  function tick(): void {
    for (const r of active()) {
      if (settling.has(r.id)) continue;
      const rec = d.registry.get(r.agentId); if (!rec) continue;
      const now = d.clock(), elapsed = now - r.startedAt;
      const settle = (f: Promise<void>) => { settling.add(r.id); f.catch(e => console.error('release settle failed', e)).finally(() => settling.delete(r.id)); };
      if (d.registry.isRevoked(r.agentId)) { settle(abort(r, 'the agent was killed during the canary')); continue; }
      const ev = evidence(r.agentId, 'production', r);
      if (ev.canary!.candidate.calls < POLICY.canaryMinCalls && elapsed < 3 * POLICY.canaryWindowMs) continue;   // not enough data yet; starved canaries give up after 3 windows
      const res = evaluatePromotion({ ...rec, lifecycleState: 'canary' }, ev);
      if (!res.allowed) settle(rollBack(r, res));
      else if (elapsed >= POLICY.canaryWindowMs) settle(promoteRelease(r, res));
    }
  }

  return {
    promote, start, tick, evidence, log, list: () => all,
    get: (id: string) => all.find(r => r.id === id),
    isActive: (variantId: string) => active().some(r => r.variantId === variantId),
    /** Adds each running canary's identity to the bundle (same scopes, models and budgets as its agent), so the gateway accepts it. */
    decorate(b: PolicyBundle): PolicyBundle {
      const extra: PolicyBundle['agents'] = {};
      for (const r of active()) if (b.agents[r.agentId] && !(r.agentId in b.revoked)) extra[r.variantId] = { ...b.agents[r.agentId], id: r.variantId };
      return Object.keys(extra).length ? { ...b, agents: { ...b.agents, ...extra } } : b;
    },
    reset() { for (const r of active()) { r.state = 'rolled_back'; r.endedAt = d.clock(); } settling.clear(); },
  };
}
export type Releases = ReturnType<typeof createReleases>;
