import http from 'node:http';
import { join } from 'node:path';
import type { ActionEvent, ActRequest, ActResponse, PolicyBundle } from '../../../contracts/types.ts';
import { PRICES, costOf } from '../../../contracts/prices.ts';
import { verifyToken } from '../../control/src/identity.ts';
import { argsHash } from '../../lib/hash.ts';
import { closeServer, createRouter, fail, listen, ok, send } from '../../lib/http.ts';
import { defaultPolicy } from './policy.ts';
import type { Decision, PolicyEngine } from './policy.ts';
import { createReceiptWriter } from './receipts.ts';

export interface GatewayOpts {
  port?: number; host?: string; controlUrl: string; toolsUrl: string; gatewayId: string; dataDir: string;
  pollMs?: number; policy?: PolicyEngine; maxQueue?: number;
  directEnabled?: boolean;   // serve the ungoverned /v1/direct baseline. Default: env RC_DIRECT_BASELINE=1, else off (404). ADR-001.
}
/** ADR-001 interface. setPolicy/kill arrive via the polled bundle (revocation, throttles), not by direct calls. */
export interface Gateway {
  url: string; id: string; close(): Promise<void>;
  forward(token: string | undefined, req: ActRequest): Promise<{ status: number; body: ActResponse }>;
  direct(req: ActRequest): Promise<{ status: number; body: ActResponse }>;
}

const hr = () => Number(process.hrtime.bigint()) / 1e6; // ms, sub-ms resolution
const ACCT = /\b\d{9,19}\b/g;
const maskStr = (s: string) => s.replace(ACCT, m => '*'.repeat(m.length - 4) + m.slice(-4));
/** Redact account-number-like digit runs (9-19 digits) in every string of args/results. */
export function mask<T>(v: T): T {
  if (typeof v === 'string') return maskStr(v) as T;
  if (Array.isArray(v)) return v.map(mask) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x)])) as T;
  return v;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
/** Shape check only (no signature yet): reject anything the policy engine could not safely read. */
export const validBundle = (b: any): b is PolicyBundle =>
  isObj(b) && typeof b.version === 'number' && isObj(b.agents) && isObj(b.revoked) && isObj(b.throttles) && isObj(b.prices)
  && Array.isArray(b.highRiskTools) && typeof b.staleAfterMs === 'number' && Number.isFinite(b.staleAfterMs);

// 10 us .. 100 ms. 0.05 (the 50 ms SLO threshold) must stay a bucket edge: slo/decision-latency-p99.yaml reads le="0.05".
const BUCKETS = [0.00001, 0.000025, 0.00005, 0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1];

export async function startGateway(opts: GatewayOpts): Promise<Gateway> {
  const id = opts.gatewayId, policy = opts.policy ?? defaultPolicy, maxQueue = opts.maxQueue ?? 20_000;
  const receipts = createReceiptWriter(join(opts.dataDir, 'receipts', `${id}.jsonl`), id);
  let bundle: PolicyBundle | null = null, lastFresh = 0, directSeq = 0;

  // ---- state: throttle buckets, spend counters, metrics
  const buckets = new Map<string, { rate: number; tokens: number; last: number }>();
  const win = { hour: new Map<string, { start: number; sum: number }>(), day: new Map<string, { start: number; sum: number }>() };
  const tasks = new Map<string, number>();
  const spendOf = (m: Map<string, { start: number; sum: number }>, k: string, span: number, now: number) => { const w = m.get(k); return w && now - w.start < span ? w.sum : 0; };
  const addSpend = (m: Map<string, { start: number; sum: number }>, k: string, span: number, now: number, usd: number) => {
    const w = m.get(k); if (!w || now - w.start >= span) m.set(k, { start: now, sum: usd }); else w.sum += usd;
  };
  const decisions = new Map<string, number>();
  const hist = new Array(BUCKETS.length + 1).fill(0); let histSum = 0, histCount = 0, dropped = 0, spendTotal = 0, bundlesRejected = 0, receiptsTotal = 0;
  const byAgent = new Map<string, number>(); // key agent|verdict; agent is the authenticated id or 'unauthenticated' so callers cannot inflate cardinality
  const observe = (ms: number) => { const s = ms / 1000; let i = 0; while (i < BUCKETS.length && s > BUCKETS[i]) i++; hist[i]++; histSum += s; histCount++; };

  function takeToken(agentId: string, now: number): boolean {
    const th = bundle?.throttles[agentId];
    if (!th) { buckets.delete(agentId); return true; }
    let b = buckets.get(agentId);
    const cap = Math.max(1, th.ratePerSec);
    if (!b || b.rate !== th.ratePerSec) { b = { rate: th.ratePerSec, tokens: cap, last: now }; buckets.set(agentId, b); }
    b.tokens = Math.min(cap, b.tokens + ((now - b.last) / 1000) * b.rate); b.last = now;
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    return false;
  }

  // ---- bundle poll (static stability: keep the cached bundle when control is unreachable)
  async function refresh(): Promise<void> {
    try {
      const r = await fetch(`${opts.controlUrl}/v1/bundle?gw=${encodeURIComponent(id)}&v=${bundle?.version ?? 0}`, { signal: AbortSignal.timeout(500) });
      if (!r.ok) return;
      const b = await r.json().catch(() => null);
      if (validBundle(b)) { bundle = b; lastFresh = Date.now(); } else bundlesRejected++; // malformed: keep the last good bundle, do not count it as fresh
    } catch { /* control unreachable or body unreadable: continue on the cached bundle */ }
  }
  await refresh();
  const poll = setInterval(refresh, opts.pollMs ?? 200);

  // ---- event batching: bounded, drop-oldest, counted
  let queue: ActionEvent[] = [], pushing = false;
  const enqueue = (e: ActionEvent) => { queue.push(e); if (queue.length > maxQueue) { const n = queue.length - maxQueue; queue.splice(0, n); dropped += n; } };
  async function pushEvents(): Promise<void> {
    if (pushing || !queue.length) return;
    pushing = true; const batch = queue.splice(0, 500);
    try {
      const r = await fetch(`${opts.controlUrl}/v1/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: batch }), signal: AbortSignal.timeout(1000) });
      if (!r.ok) throw new Error('rejected');
    } catch { queue = batch.concat(queue); if (queue.length > maxQueue) { dropped += queue.length - maxQueue; queue = queue.slice(-maxQueue); } }
    finally { pushing = false; }
  }
  const pusher = setInterval(pushEvents, 100);

  async function callTool(tool: string, req: ActRequest, args: unknown): Promise<{ result?: any; error?: string }> {
    try {
      const r = await fetch(`${opts.toolsUrl}/tool/${encodeURIComponent(tool)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: req.agentId, args, model: req.model, targetAgentId: req.targetAgentId }), signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { error: `tool returned ${r.status}` };
      return { result: await r.json() };
    } catch (e) { return { error: (e as Error).message }; }
  }

  function record(req: ActRequest, ah: string, d: { verdict: ActionEvent['verdict']; code: string }, cost: number, latencyMs: number, rid: string, governed: boolean): void {
    enqueue({ ts: Date.now(), gatewayId: id, receiptId: rid, agentId: req.agentId, tool: req.tool, argsHash: ah, targetAgentId: req.targetAgentId, verdict: d.verdict, code: d.code, costUsd: cost, latencyMs, governed });
  }

  async function forward(token: string | undefined, req: ActRequest): Promise<{ status: number; body: ActResponse }> {
    const t0 = hr(), now = Date.now();
    const ah = argsHash(req.args);
    const v = verifyToken(token ?? '', now);
    let d: Decision;
    if (!v.ok) d = { allow: false, verdict: 'deny', code: 'UNAUTHENTICATED', ruleId: 'identity.invalid', reason: `Identity token rejected: ${v.reason}.` };
    else if (v.agentId !== req.agentId) d = { allow: false, verdict: 'deny', code: 'IDENTITY_MISMATCH', ruleId: 'identity.mismatch', reason: `Token belongs to '${v.agentId}', not '${req.agentId}'.` };
    else {
      const task = `${req.agentId}:${req.taskId ?? ''}`;
      d = policy.evaluate({
        agentId: req.agentId, tool: req.tool, model: req.model, bundle, bundleAgeMs: now - lastFresh, estCostUsd: bundle?.prices[req.tool] ?? 0,
        spend: { hourUsd: spendOf(win.hour, req.agentId, 3_600_000, now), dayUsd: spendOf(win.day, req.agentId, 86_400_000, now), taskUsd: tasks.get(task) ?? 0 },
        takeToken: () => takeToken(req.agentId, now),
      });
    }
    let cost = 0, result: unknown, code = d.code, verdict = d.verdict, reason = d.reason, status = d.allow ? 200 : d.verdict === 'throttle' ? 429 : 403, toolMs = 0;
    if (d.allow) {
      const a = hr();
      const out = await callTool(req.tool, req, mask(req.args));
      toolMs = hr() - a;
      if (out.error) { verdict = 'deny'; code = 'TOOL_ERROR'; reason = `Tool call failed: ${out.error}.`; status = 502; }
      else {
        result = mask(out.result?.result ?? out.result);
        cost = costOf(req.tool, bundle?.prices ?? PRICES, out.result);
        if (cost) {
          spendTotal += cost;
          addSpend(win.hour, req.agentId, 3_600_000, now, cost); addSpend(win.day, req.agentId, 86_400_000, now, cost);
          if (req.taskId) { const k = `${req.agentId}:${req.taskId}`; tasks.set(k, (tasks.get(k) ?? 0) + cost); if (tasks.size > 20_000) tasks.delete(tasks.keys().next().value!); }
        }
      }
    }
    const rec = receipts.append({ agentId: req.agentId, tool: req.tool, argsHash: ah, verdict, code, costUsd: cost }); receiptsTotal++;
    const latencyMs = hr() - t0 - toolMs;
    record(req, ah, { verdict, code }, cost, latencyMs, rec.id, true);
    const key = `${verdict}|${code}`; decisions.set(key, (decisions.get(key) ?? 0) + 1); observe(latencyMs);
    const ak = `${v.ok && v.agentId === req.agentId ? req.agentId : 'unauthenticated'}|${verdict}`; byAgent.set(ak, (byAgent.get(ak) ?? 0) + 1);
    return { status, body: { verdict, reason, code, receiptId: rec.id, costUsd: cost, latencyMs, ...(result !== undefined ? { result } : {}) } };
  }

  /** Ungoverned baseline (only when directEnabled): no identity, scope, throttle, budget or masking. Still recorded as an event with a `direct:` receipt id and governed:false; not appended to the hash chain. */
  async function direct(req: ActRequest): Promise<{ status: number; body: ActResponse }> {
    const t0 = hr(); const ah = argsHash(req.args);
    const a = hr(); const out = await callTool(req.tool, req, req.args); const toolMs = hr() - a;
    const cost = out.error ? 0 : costOf(req.tool, bundle?.prices ?? PRICES, out.result);
    const rid = `direct:${id}:${directSeq++}`, latencyMs = hr() - t0 - toolMs;
    const verdict = out.error ? 'deny' : 'allow', code = out.error ? 'TOOL_ERROR' : 'OK';
    record(req, ah, { verdict, code }, cost, latencyMs, rid, false);
    return { status: out.error ? 502 : 200, body: { verdict, code, reason: out.error ?? 'Ungoverned call: no policy applied.', receiptId: rid, costUsd: cost, latencyMs, result: out.result?.result } };
  }

  const r = createRouter();
  const bearer = (h: string | undefined) => (h ?? '').replace(/^Bearer\s+/i, '');
  const valid = (b: any): b is ActRequest => b && typeof b.agentId === 'string' && typeof b.tool === 'string';
  r.add('POST', '/v1/act', async c => { const b = await c.json(); if (!valid(b)) return fail(400, 'agentId and tool required'); const o = await forward(bearer(c.req.headers.authorization), { ...b, args: b.args ?? {} }); return { status: o.status, body: o.body }; });
  const directEnabled = opts.directEnabled ?? process.env.RC_DIRECT_BASELINE === '1';
  r.add('POST', '/v1/direct', async c => { if (!directEnabled) return fail(404, 'not found'); const b = await c.json(); if (!valid(b)) return fail(400, 'agentId and tool required'); const o = await direct({ ...b, args: b.args ?? {} }); return { status: o.status, body: o.body }; });
  r.add('GET', '/healthz', () => ok({ ok: true, gatewayId: id, bundleVersion: bundle?.version ?? null, bundleAgeMs: Date.now() - lastFresh }));
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      const L: string[] = ['# TYPE rollcall_gateway_decisions_total counter'];
      for (const [k, n] of decisions) { const [vd, cd] = k.split('|'); L.push(`rollcall_gateway_decisions_total{gateway="${id}",verdict="${vd}",code="${cd}"} ${n}`); }
      L.push('# TYPE rollcall_gateway_agent_decisions_total counter');
      for (const [k, n] of byAgent) { const [ag, vd] = k.split('|'); L.push(`rollcall_gateway_agent_decisions_total{gateway="${id}",agent="${ag}",verdict="${vd}"} ${n}`); }
      L.push('# TYPE rollcall_gateway_receipts_total counter', `rollcall_gateway_receipts_total{gateway="${id}"} ${receiptsTotal}`);
      L.push('# TYPE rollcall_gateway_events_dropped_total counter', `rollcall_gateway_events_dropped_total{gateway="${id}"} ${dropped}`);
      L.push('# TYPE rollcall_gateway_bundles_rejected_total counter', `rollcall_gateway_bundles_rejected_total{gateway="${id}"} ${bundlesRejected}`);
      L.push('# TYPE rollcall_gateway_spend_usd_total counter', `rollcall_gateway_spend_usd_total{gateway="${id}"} ${spendTotal}`);
      L.push('# TYPE rollcall_gateway_bundle_age_ms gauge', `rollcall_gateway_bundle_age_ms{gateway="${id}"} ${Date.now() - lastFresh}`);
      L.push('# TYPE rollcall_gateway_decision_seconds histogram');
      let cum = 0; BUCKETS.forEach((b, i) => { cum += hist[i]; L.push(`rollcall_gateway_decision_seconds_bucket{gateway="${id}",le="${b}"} ${cum}`); });
      L.push(`rollcall_gateway_decision_seconds_bucket{gateway="${id}",le="+Inf"} ${histCount}`, `rollcall_gateway_decision_seconds_sum{gateway="${id}"} ${histSum}`, `rollcall_gateway_decision_seconds_count{gateway="${id}"} ${histCount}`);
      return send(res, 200, L.join('\n') + '\n');
    }
    if (!(await r.handle(req, res))) send(res, 404, { error: 'not found' });
  });
  const url = await listen(server, opts.port ?? 0, opts.host);
  let closed = false;
  return {
    url, id, forward, direct,
    async close() {
      if (closed) return; closed = true;
      clearInterval(poll); clearInterval(pusher);
      await pushEvents().catch(() => {});
      receipts.close();
      await closeServer(server);
    },
  };
}
