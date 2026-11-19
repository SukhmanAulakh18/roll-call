import http from 'node:http';
import type { AgentRecord } from '../contracts/types.ts';
import { closeServer, createRouter, fail, listen, ok } from '../services/lib/http.ts';
import type { DrillMode, FaultKind, FleetControl } from '../services/control/src/runtime.ts';

// ---------------------------------------------------------------- the registered fleet (all names fictional)
type Over = Partial<AgentRecord> & Pick<AgentRecord, 'id' | 'name' | 'purpose' | 'riskRating' | 'lifecycleState' | 'scopes'> & { team: string; owner_: string };
const mk = (o: Over): AgentRecord => {
  const { team, owner_, ...rest } = o;
  const slug = team.toLowerCase().replace(/[^a-z]+/g, '-');
  return {
    owner: { name: owner_, team, escalation: `pager:${slug}-oncall (simulated)` },
    developer: 'Agent Platform Team (fictional)', origin: 'internal', version: '1.0.0', deploymentDate: '2026-06-02',
    reviewer: 'R. Okafor (Model Risk, fictional)', approver: 'T. Lindqvist (Risk Committee, fictional)',
    dataSources: ['synthetic-ledger'], approvedUses: [], limitations: [], models: ['sim-small'], residency: 'ca-central',
    evaluation: { evidenceUrl: `https://evidence.rollcall.local/evals/${o.id}`, passed: true, date: '2026-05-20' },
    budgets: { perHourUsd: 30, perDayUsd: 400, perTaskUsd: 5 },
    reviewDate: '2026-09-01', nextMonitoringDate: '2027-03-01',
    runtimeRef: { kind: 'SimProcess', name: o.id, namespace: 'agents' },
    ...rest,
  };
};
const sc = (tools: string[], data: string[] = ['synthetic-ledger']) => ({ tools, data });

export const FLEET: AgentRecord[] = [
  mk({ id: 'fraud-triage', name: 'Fraud Triage Assistant', purpose: 'Ranks suspicious card transactions for analyst review and drafts the rationale.', team: 'Fraud Operations', owner_: 'Dana K. (Fraud Operations)',
    riskRating: 'high', lifecycleState: 'production', scopes: sc(['txn.lookup', 'kyc.lookup', 'fraud.flag', 'llm.complete', 'ledger.read'], ['synthetic-transactions', 'synthetic-kyc']),
    approvedUses: ['Prioritise alerts for human analysts', 'Draft case rationale'], limitations: ['Never blocks a card on its own', 'English only'] }),
  mk({ id: 'kyc-refresh', name: 'KYC Refresh Agent', purpose: 'Checks customer due-diligence files for staleness and drafts refresh requests.', team: 'Client Onboarding', owner_: 'Marcus T. (Client Onboarding)',
    riskRating: 'medium', lifecycleState: 'production', scopes: sc(['kyc.lookup', 'docs.search', 'llm.complete'], ['synthetic-kyc']),
    approvedUses: ['Flag stale KYC files', 'Draft refresh requests for human send'], limitations: ['Read-only on customer files'] }),
  mk({ id: 'aml-testgen', name: 'AML Test Scenario Generator', purpose: 'Drafts AML monitoring test scenarios. Every output waits in an approval queue for a human before it is used.', team: 'Financial Crime Compliance', owner_: 'Priya N. (Financial Crime Compliance)',
    riskRating: 'high', lifecycleState: 'canary', scopes: sc(['docs.search', 'llm.complete', 'approvals.enqueue'], ['synthetic-aml-typologies']),
    models: ['sim-large'], approvedUses: ['Generate test scenarios for monitoring-rule validation', 'Human-governed: nothing is used until a reviewer approves it in the queue'],
    limitations: ['No access to production customer data', 'Outputs are drafts, never evidence'] }),
  mk({ id: 'invoice-recon', name: 'Invoice Reconciliation Agent', purpose: 'Matches supplier invoices to ledger entries and posts adjustments within tolerance.', team: 'Finance Operations', owner_: 'Hiro S. (Finance Operations)',
    riskRating: 'medium', lifecycleState: 'production', scopes: sc(['ledger.read', 'ledger.post', 'docs.search', 'llm.complete']),
    approvedUses: ['Match invoices to ledger lines', 'Post rounding adjustments under tolerance'], limitations: ['Adjustments capped by ledger.post policy'] }),
  mk({ id: 'mortgage-docs', name: 'Mortgage Document Checker', purpose: 'Checks mortgage application packages for missing or stale documents.', team: 'Retail Lending', owner_: 'Elena V. (Retail Lending)',
    riskRating: 'medium', lifecycleState: 'production', scopes: sc(['docs.search', 'llm.complete', 'kyc.lookup'], ['synthetic-mortgage-files']),
    approvedUses: ['Completeness checks on applications'], limitations: ['Does not assess creditworthiness'] }),
  mk({ id: 'support-summarizer', name: 'Support Case Summarizer', purpose: 'Summarises customer support cases for the next agent in the queue.', team: 'Customer Care', owner_: 'Sam O. (Customer Care)',
    riskRating: 'low', lifecycleState: 'production', scopes: sc(['docs.search', 'llm.complete', 'txn.lookup'], ['synthetic-cases']),
    approvedUses: ['Summarise cases'], limitations: ['No money movement of any kind'], budgets: { perHourUsd: 20, perDayUsd: 250, perTaskUsd: 3 } }),
  mk({ id: 'limits-checker', name: 'Credit Limits Checker', purpose: 'Confirms exposure against approved credit limits and answers other agents.', team: 'Credit Risk', owner_: 'Anika R. (Credit Risk)',
    riskRating: 'high', lifecycleState: 'production', scopes: sc(['limits.get', 'ledger.read', 'agent.call', 'llm.complete'], ['synthetic-limits']),
    approvedUses: ['Limit confirmation'], limitations: ['Advisory only'] }),
  mk({ id: 'credit-memo', name: 'Credit Memo Drafter', purpose: 'Drafts credit memos and asks the limits checker to confirm exposure.', team: 'Credit Risk', owner_: 'Jonas B. (Credit Risk)',
    riskRating: 'high', lifecycleState: 'canary', scopes: sc(['docs.search', 'ledger.read', 'llm.complete', 'agent.call', 'limits.get'], ['synthetic-limits', 'synthetic-credit-files']),
    models: ['sim-large'], approvedUses: ['Draft memos for human credit officers'], limitations: ['Recommendation field left blank for the human approver'] }),
  mk({ id: 'payment-orchestrator', name: 'Payment Orchestrator', purpose: 'Routes approved low-value payments to the cheapest available rail.', team: 'Payments Operations', owner_: 'Priya N. (Payments Ops)',
    riskRating: 'critical', lifecycleState: 'production', scopes: sc(['payments.transfer', 'ledger.read', 'txn.lookup', 'fraud.flag'], ['synthetic-payments']),
    approvedUses: ['Route approved payments under the per-payment cap'], limitations: ['Cap of 500 CAD per payment enforced by the payments rail'], budgets: { perHourUsd: 40, perDayUsd: 500, perTaskUsd: 5 } }),
  mk({ id: 'collections-nudge', name: 'Collections Reminder Agent', purpose: 'Drafts and queues friendly payment reminders.', team: 'Collections', owner_: 'Lucia M. (Collections)',
    riskRating: 'medium', lifecycleState: 'production', scopes: sc(['mail.send', 'ledger.read', 'llm.complete'], ['synthetic-arrears']),
    approvedUses: ['Send pre-approved reminder templates'], limitations: ['Templates only; no negotiation'] }),
  mk({ id: 'regulatory-digest', name: 'Regulatory Digest Agent', purpose: 'Summarises new supervisory publications for compliance staff.', team: 'Compliance Advisory', owner_: 'Owen P. (Compliance Advisory)',
    riskRating: 'low', lifecycleState: 'shadow', scopes: sc(['docs.search', 'llm.complete'], ['synthetic-publications']),
    evaluation: { evidenceUrl: 'https://evidence.rollcall.local/evals/regulatory-digest', passed: false, date: '2026-06-11' },
    approvedUses: ['Shadow-mode summaries, not yet shown to staff'], limitations: ['Evaluation failed: summaries omitted key obligations in 3 of 20 samples'] }),
  mk({ id: 'treasury-forecast', name: 'Treasury Forecast Narrator', purpose: 'Writes plain-English commentary on liquidity forecasts.', team: 'Treasury', owner_: 'Mei L. (Treasury)',
    riskRating: 'medium', lifecycleState: 'shadow', scopes: sc(['ledger.read', 'llm.complete', 'docs.search'], ['synthetic-liquidity']),
    evaluation: null, approvedUses: ['Shadow-mode commentary for the treasury team'], limitations: ['No evaluation on record yet'] }),
];

// ---------------------------------------------------------------- baseline behaviour
type Rng = () => number;
const mulberry32 = (a: number): Rng => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const strHash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const pick = <T,>(r: Rng, a: T[]): T => a[Math.floor(r() * a.length)];
const num = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo));
const SEGMENTS = ['retail', 'smb', 'commercial', 'private', 'corporate'];
const ARGS: Record<string, (r: Rng, rec: AgentRecord, n: number) => Record<string, unknown>> = {
  'ledger.read': r => ({ accountId: String(num(r, 100000000000, 999999999999)) }),   // 12-digit synthetic numbers: the gateway masks them
  'ledger.post': r => ({ accountId: String(num(r, 100000000000, 999999999999)), amount: num(r, 1, 50), memo: `rounding-adj-${num(r, 1000, 99999)}` }),
  'txn.lookup': r => ({ txn: `T-${num(r, 100000, 999999)}` }),
  'kyc.lookup': r => ({ customer: `C-${num(r, 10000, 99999)}` }),
  'docs.search': r => ({ query: `${pick(r, ['policy', 'procedure', 'guideline', 'standard', 'checklist'])} ${num(r, 1, 400)}` }),
  'llm.complete': (r, rec) => ({ prompt: `${rec.id}: task ${num(r, 1, 90000)}` }),
  'payments.transfer': r => ({ from: String(num(r, 100000000000, 999999999999)), to: String(num(r, 100000000000, 999999999999)), amount: num(r, 5, 400) }),
  'fraud.flag': r => ({ txn: `T-${num(r, 100000, 999999)}`, reason: pick(r, ['velocity', 'geo-mismatch', 'device-new']) }),
  'agent.call': (r, rec) => ({ question: `${rec.id} request ${num(r, 1, 90000)}` }),
  'limits.get': r => ({ segment: pick(r, SEGMENTS), counterparty: `CP-${num(r, 1000, 9999)}` }),
  'mail.send': r => ({ template: pick(r, ['reminder-1', 'reminder-2']), customer: `C-${num(r, 10000, 99999)}` }),
  'approvals.enqueue': r => ({ kind: 'aml-test-scenario', scenario: `S-${num(r, 1000, 99999)}` }),
};
/** calls/s and weighted tool mix per agent. These are the agent's normal behaviour; the detector learns its own baseline from it. */
const BASELINE: Record<string, { rate: number; mix: [string, number][]; target?: string }> = {
  'fraud-triage': { rate: 2.5, mix: [['txn.lookup', 4], ['kyc.lookup', 2], ['ledger.read', 2], ['fraud.flag', 1], ['llm.complete', 1]] },
  'kyc-refresh': { rate: 2, mix: [['kyc.lookup', 6], ['docs.search', 2], ['llm.complete', 1]] },
  'aml-testgen': { rate: 1, mix: [['docs.search', 3], ['llm.complete', 3], ['approvals.enqueue', 2]] },
  'invoice-recon': { rate: 2, mix: [['ledger.read', 5], ['docs.search', 2], ['llm.complete', 2], ['ledger.post', 1]] },
  'mortgage-docs': { rate: 2, mix: [['docs.search', 5], ['llm.complete', 2], ['kyc.lookup', 2]] },
  'support-summarizer': { rate: 1.5, mix: [['docs.search', 3], ['llm.complete', 3], ['txn.lookup', 2]] },
  'limits-checker': { rate: 1.5, mix: [['limits.get', 4], ['ledger.read', 3], ['agent.call', 1]], target: 'credit-memo' },
  'credit-memo': { rate: 1.5, mix: [['docs.search', 3], ['llm.complete', 2], ['ledger.read', 2], ['agent.call', 1]], target: 'limits-checker' },
  'payment-orchestrator': { rate: 1, mix: [['ledger.read', 4], ['txn.lookup', 3], ['payments.transfer', 2], ['fraud.flag', 1]] },
  'collections-nudge': { rate: 1, mix: [['ledger.read', 4], ['llm.complete', 3], ['mail.send', 1]] },
  'regulatory-digest': { rate: 0.8, mix: [['docs.search', 3], ['llm.complete', 2]] },
  'treasury-forecast': { rate: 0.8, mix: [['ledger.read', 3], ['llm.complete', 2], ['docs.search', 2]] },
};
const PARTNER: Record<string, string> = { 'limits-checker': 'credit-memo', 'credit-memo': 'limits-checker' };
const FAULT_RATE: Record<FaultKind, number | null> = { 'runaway-loop': 40, 'ping-pong': 20, 'scope-drift': 4, 'healthy-burst': 30, 'slow-repeat': null };

// ---------------------------------------------------------------- runtime
export interface FleetOpts { controlUrl: string; gatewayUrls: string[]; agents?: AgentRecord[]; seed?: number }
export interface FleetHandle extends FleetControl {
  close(): Promise<void>;
  stats(): Record<string, { calls: number; allow: number; deny: number; throttle: number; errors: number }>;
}
type Fault = { kind: FaultKind; mode: DrillMode; rate: number; target?: string };
type Call = { tool: string; args: Record<string, unknown>; target?: string };

export async function startFleet(opts: FleetOpts): Promise<FleetHandle> {
  const recs = opts.agents ?? FLEET;
  const seed = opts.seed ?? 1;
  type A = { rec: AgentRecord; running: boolean; fault?: Fault; token: string; exp: number; ttl: number; n: number; rng: Rng; gen: number; wake?: () => void; timer?: NodeJS.Timeout; loop?: Promise<void>; fixed?: Call[]; st: { calls: number; allow: number; deny: number; throttle: number; errors: number } };
  const agents = new Map<string, A>();
  for (const rec of recs) agents.set(rec.id, { rec, running: false, token: '', exp: 0, ttl: 60_000, n: 0, rng: mulberry32(strHash(rec.id) + seed), gen: 0, st: { calls: 0, allow: 0, deny: 0, throttle: 0, errors: 0 } });
  let gwRound = 0;

  const sleep = (a: A, ms: number) => new Promise<void>(res => { a.wake = res; a.timer = setTimeout(res, ms); a.timer.unref(); });
  async function ensureToken(a: A): Promise<void> {
    if (a.token && a.exp - Date.now() > a.ttl / 2) return;               // renew with half the TTL left
    try {
      const r = await fetch(`${opts.controlUrl}/v1/identity/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: a.rec.id }), signal: AbortSignal.timeout(1000) });
      if (r.ok) { const t = await r.json() as { token: string; expiresAt: number }; a.token = t.token; a.ttl = t.expiresAt - Date.now(); a.exp = t.expiresAt; }
      else if (r.status === 403 || r.status === 404) { a.running = false; a.wake?.(); }  // revoked or unregistered: this process is done
    } catch { /* control unreachable: keep the token we have until it expires */ }
  }

  function nextCall(a: A): Call {
    const b = BASELINE[a.rec.id], f = a.fault, n = a.n++;
    const normal = (): Call => {
      let w = Math.random(); // tool choice need not be reproducible; arguments are (seeded)
      const tot = b.mix.reduce((s, [, x]) => s + x, 0); w = a.rng() * tot;
      let tool = b.mix[0][0]; for (const [t, x] of b.mix) { if ((w -= x) < 0) { tool = t; break; } }
      return { tool, args: ARGS[tool](a.rng, a.rec, n), target: tool === 'agent.call' ? b.target : undefined };
    };
    if (!f) return normal();
    switch (f.kind) {
      case 'runaway-loop': return n % 2 ? { tool: 'llm.complete', args: { prompt: 'invoice-recon: retry reconcile INV-77031' } } : { tool: 'ledger.read', args: { accountId: '400000771031' } };
      case 'ping-pong': return { tool: 'agent.call', args: { topic: 'limit-confirmation' }, target: f.target };
      case 'healthy-burst': return normal();
      case 'slow-repeat': return a.fixed![0];
      case 'scope-drift': {
        if (n % 2) return normal();
        const t = ['payments.transfer', 'mail.send'].find(x => !a.rec.scopes.tools.includes(x))!;
        return { tool: t, args: ARGS[t](a.rng, a.rec, n) };
      }
    }
  }

  async function step(a: A, mode: DrillMode): Promise<void> {
    const c = nextCall(a);
    const body = JSON.stringify({ agentId: a.rec.id, tool: c.tool, args: c.args, taskId: `${a.rec.id}-t${Math.floor(a.n / 12)}`, model: c.tool === 'llm.complete' ? a.rec.models[0] : undefined, targetAgentId: c.target });
    const gw = opts.gatewayUrls[gwRound++ % opts.gatewayUrls.length];
    a.st.calls++;
    try {
      let r: Response;
      if (mode === 'ungoverned') r = await fetch(`${gw}/v1/direct`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(3000) });
      else { await ensureToken(a); r = await fetch(`${gw}/v1/act`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.token}` }, body, signal: AbortSignal.timeout(3000) }); }
      const j = await r.json() as { verdict?: string };
      if (j.verdict === 'allow') a.st.allow++; else if (j.verdict === 'throttle') a.st.throttle++; else a.st.deny++;
    } catch { a.st.errors++; }
  }

  async function run(a: A, gen: number): Promise<void> {
    let next = Date.now() + a.rng() * 400;                                  // stagger starts
    while (a.running && a.gen === gen) {
      const f = a.fault, rate = f?.rate ?? BASELINE[a.rec.id].rate;
      const jitter = f && f.kind !== 'healthy-burst' ? 0.1 : 0.5;          // faults are metronomic; normal traffic is bursty
      next += (1000 / rate) * (1 + (a.rng() - 0.5) * jitter);
      const wait = next - Date.now();
      if (wait > 0) await sleep(a, wait); else if (wait < -500) next = Date.now();
      if (!a.running || a.gen !== gen) break;
      await step(a, f?.mode ?? 'governed');
    }
  }

  const start = async (id: string) => {
    const a = agents.get(id); if (!a || a.running) return;
    a.running = true; a.token = ''; a.gen++; a.loop = run(a, a.gen);
  };
  const stop = async (id: string) => { const a = agents.get(id); if (!a) return; a.running = false; clearTimeout(a.timer); a.wake?.(); };
  const clear = async (id?: string) => { for (const a of id ? [agents.get(id)!] : agents.values()) { if (!a) continue; a.fault = undefined; a.wake?.(); } };

  const handle: FleetHandle = {
    running: async () => [...agents.values()].filter(a => a.running).map(a => a.rec.id),
    start, stop, clear,
    async inject(id, kind, mode) {
      const a = agents.get(id); if (!a) throw new Error(`unknown agent '${id}'`);
      const base = BASELINE[id].rate;
      a.fault = { kind, mode, rate: FAULT_RATE[kind] ?? base, target: PARTNER[id] };
      if (kind === 'slow-repeat') a.fixed = [{ tool: BASELINE[id].mix[0][0], args: ARGS[BASELINE[id].mix[0][0]](mulberry32(7), a.rec, 0) }];
      if (kind === 'ping-pong' && PARTNER[id]) { const p = agents.get(PARTNER[id])!; p.fault = { kind, mode, rate: FAULT_RATE[kind]!, target: id }; p.wake?.(); }
      a.wake?.();
    },
    async reset() { await clear(); for (const id of agents.keys()) await start(id); },
    stats: () => Object.fromEntries([...agents].map(([k, a]) => [k, { ...a.st }])),
    async close() { for (const id of agents.keys()) await stop(id); await Promise.all([...agents.values()].map(a => a.loop)); },
  };
  for (const id of agents.keys()) await start(id);
  return handle;
}

/** HTTP face of a fleet for `serve.ts --role fleet`, so a separate control process can kill and run drills. */
export async function serveFleet(fleet: FleetControl, port: number, host?: string): Promise<{ url: string; close(): Promise<void> }> {
  const r = createRouter();
  r.add('POST', '/fleet/running', async () => ok({ running: await fleet.running() }));
  r.add('POST', '/fleet/stop', async c => { await fleet.stop((await c.json()).agentId); return ok({ ok: true }); });
  r.add('POST', '/fleet/start', async c => { await fleet.start((await c.json()).agentId); return ok({ ok: true }); });
  r.add('POST', '/fleet/inject', async c => { const b = await c.json(); await fleet.inject(b.agentId, b.kind, b.mode); return ok({ ok: true }); });
  r.add('POST', '/fleet/clear', async c => { await fleet.clear((await c.json()).agentId); return ok({ ok: true }); });
  r.add('POST', '/fleet/reset', async () => { await fleet.reset(); return ok({ ok: true }); });
  r.add('GET', '/healthz', () => ok({ ok: true }));
  const server = http.createServer(async (req, res) => { if (!(await r.handle(req, res))) { res.writeHead(404); res.end(); } });
  const url = await listen(server, port, host);
  return { url, close: () => closeServer(server) };
}
void fail;
