// make chaos: in-process game days against the real control + gateway + fleet code. Merges the `chaos` section into impact.json.
// Each scenario: hypothesis, steady state, blast radius, abort condition, recovery, measured results. Nothing here is estimated.
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startControl } from '../services/control/src/app.ts';
import { startGateway } from '../services/gateway/src/app.ts';
import type { Gateway } from '../services/gateway/src/app.ts';
import { verifyChain } from '../services/gateway/src/receipts.ts';
import { closeServer, listen, sleep } from '../services/lib/http.ts';
import { startStack } from '../sim/stack.ts';
import { mergeImpact, pct } from './lib/impact.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'rollcall-chaos-'));
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
class Abort extends Error {}

// ---------------------------------------------------------------- load driver: mini agents that renew like the fleet does (at half TTL)
type Plan = { id: string; tool: string; risk: 'low' | 'high'; args: Record<string, unknown> };
const PLAN: Plan[] = [
  { id: 'kyc-refresh', tool: 'kyc.lookup', risk: 'low', args: { customer: 'C-1' } },
  { id: 'invoice-recon', tool: 'ledger.read', risk: 'low', args: { accountId: '123456789012' } },
  { id: 'payment-orchestrator', tool: 'payments.transfer', risk: 'high', args: { amount: 5 } },
];
type Obs = { t: number; agent: string; risk: 'low' | 'high'; status: number; code: string; lat: number };
function drive(o: { gws: string[]; controlUrl: string; rps: number }) {
  const obs: Obs[] = [], renew = { ok: 0, fail: 0 }, tok = new Map<string, { tok: string; exp: number; ttl: number }>();
  let on = true;
  const loops = PLAN.map(async (p, i) => {
    const st = { tok: '', exp: 0, ttl: 0 }; tok.set(p.id, st); let n = 0;
    while (on) {
      const t0 = Date.now();
      if (!st.tok || st.exp - t0 < st.ttl / 2) {
        try {
          const r = await fetch(`${o.controlUrl}/v1/identity/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: p.id }), signal: AbortSignal.timeout(1000) });
          if (r.ok) { const j = await r.json() as { token: string; expiresAt: number }; st.tok = j.token; st.exp = j.expiresAt; st.ttl = j.expiresAt - Date.now(); renew.ok++; } else renew.fail++;
        } catch { renew.fail++; }
      }
      let status = 0, code = 'NETWORK', lat = NaN;
      try {
        const r = await fetch(`${o.gws[(n++ + i) % o.gws.length]}/v1/act`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${st.tok}` }, body: JSON.stringify({ agentId: p.id, tool: p.tool, args: p.args }), signal: AbortSignal.timeout(3000) });
        const b = await r.json() as { code: string; latencyMs: number }; status = r.status; code = b.code; lat = b.latencyMs;
      } catch { /* counted as NETWORK */ }
      obs.push({ t: t0, agent: p.id, risk: p.risk, status, code, lat });
      await sleep(Math.max(0, 1000 / o.rps - (Date.now() - t0)));
    }
  });
  return { obs, renew, tok, async stop() { on = false; await Promise.all(loops); } };
}
const within = (obs: Obs[], from: number, to: number, f: (o: Obs) => boolean = () => true) => obs.filter(o => o.t >= from && o.t < to && f(o));
const okRatio = (xs: Obs[]) => ({ calls: xs.length, ok: xs.filter(x => x.code === 'OK').length, ratio: xs.length ? r4(xs.filter(x => x.code === 'OK').length / xs.length) : null });
const codes = (xs: Obs[]) => xs.reduce<Record<string, number>>((m, x) => (m[x.code] = (m[x.code] ?? 0) + 1, m), {});
const steadyGuard = (what: string, r: { ratio: number | null }) => { if (r.ratio === null || r.ratio < 0.99) throw new Abort(`steady state not met before injection (${what}: ${r.ratio}); no fault injected`); };

// ---------------------------------------------------------------- fault-injecting proxy in front of control (issuer, bundle and events faults)
function faultProxy(target: string) {
  const f = { issuerDown: false, events: 'ok' as 'ok' | 'slow' | 'down', bundle: 'ok' as 'ok' | 'garbage' | 'http500' | 'badshape' | 'empty' };
  const server = http.createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const reply = (st: number, body: string, ct = 'application/json') => { if (!res.writableEnded) { res.writeHead(st, { 'content-type': ct }); res.end(body); } };
    if (path === '/v1/identity/token' && f.issuerDown) return reply(503, '{"error":"issuer down (injected)"}');
    if (path === '/v1/events' && f.events === 'down') return reply(503, '{"error":"events down (injected)"}');
    if (path === '/v1/events' && f.events === 'slow') { const t = setTimeout(() => reply(503, '{}'), 5000); res.on('close', () => clearTimeout(t)); return; }
    if (path === '/v1/bundle' && f.bundle !== 'ok') {
      if (f.bundle === 'http500') return reply(500, '{"error":"bundle build failed (injected)"}');
      if (f.bundle === 'garbage') return reply(200, '<html>not a bundle', 'text/html');
      if (f.bundle === 'empty') return reply(200, '{}');
      return reply(200, JSON.stringify({ version: 99999, agents: null, revoked: [], throttles: null }));
    }
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    try {
      const r = await fetch(target + req.url, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'GET' ? undefined : Buffer.concat(chunks), signal: AbortSignal.timeout(5000) });
      reply(r.status, await r.text());
    } catch (e) { reply(502, JSON.stringify({ error: (e as Error).message })); }
  });
  return listen(server).then(url => ({ url, f, close: () => closeServer(server) }));
}
async function quietStack(extra: Partial<Parameters<typeof startStack>[0]> = {}) {
  const dataDir = tmp();
  const s = await startStack({ dataDir, fleet: false, tickMs: 0, ...extra });
  return { s, dataDir };
}
/** Stack with no gateways; one gateway pointed at `controlUrl` (a proxy). */
async function proxiedGateway(opts: { maxQueue?: number; ttlMs?: number } = {}) {
  const { s, dataDir } = await quietStack({ gateways: 0, control: opts.ttlMs ? { ttlMs: opts.ttlMs } : {} });
  const proxy = await faultProxy(s.control.url);
  const gw: Gateway = await startGateway({ controlUrl: proxy.url, toolsUrl: s.tools.url, gatewayId: 'gw-1', dataDir, pollMs: 200, maxQueue: opts.maxQueue });
  s.control.setGateways([gw.url]);
  return { s, proxy, gw, dataDir, close: async () => { await gw.close(); await proxy.close(); await s.close(); } };
}
const text = async (url: string) => (await fetch(url)).text();
const metric = (t: string, name: string) => Number(new RegExp(`^${name}\\{[^}]*\\} (\\S+)$`, 'm').exec(t)?.[1] ?? NaN);

interface Scenario {
  id: string; title: string; hypothesis: string; steadyState: string; blastRadius: string; abortCondition: string; recovery: string;
  measured: Record<string, unknown>; hypothesisHeld: boolean; aborted?: string;
}
const meta = (m: Omit<Scenario, 'measured' | 'hypothesisHeld' | 'aborted'>) => m;
async function guarded(m: ReturnType<typeof meta>, body: () => Promise<{ measured: Record<string, unknown>; held: boolean }>): Promise<Scenario> {
  console.log(`\n== ${m.id}: ${m.title}`);
  try { const r = await body(); console.log(`   hypothesis ${r.held ? 'HELD' : 'DID NOT HOLD'}`); return { ...m, measured: r.measured, hypothesisHeld: r.held }; }
  catch (e) { if (!(e instanceof Abort)) throw e; console.log(`   ABORTED: ${e.message}`); return { ...m, measured: {}, hypothesisHeld: false, aborted: e.message }; }
}

// ---------------------------------------------------------------- (a) control plane stop
const STALE_MS = 2000, STEADY_MS = 3000, OUTAGE_MS = 6000;
const controlStop = () => guarded(meta({
  id: 'control-plane-stop', title: 'Control plane stops, then restarts',
  hypothesis: 'While control is down, running agents keep succeeding on low-risk tools using the cached bundle; high-risk tools fail closed with STALE_POLICY_HIGH_RISK once the bundle is older than staleAfterMs; no new identity or admission is possible. After restart, a fresh bundle arrives and normal operation resumes without restarting gateways or agents.',
  steadyState: 'Success ratio of 3 mini-agents (2 low-risk, 1 high-risk tool) is at least 0.99 for 3 s with control up.',
  blastRadius: 'One in-process stack: 1 control, 1 gateway, 3 agents at 10 calls/s each. No other process is touched.',
  abortCondition: 'Steady-state success ratio below 0.99 before injection: no fault is injected. Outage is capped at 6 s.',
  recovery: 'Control restarts on the same port and data directory; gateways pick up the next bundle on their normal 200 ms poll.',
}), async () => {
  const { s, dataDir } = await quietStack();
  const port = Number(new URL(s.control.url).port); let control2: Awaited<ReturnType<typeof startControl>> | undefined;
  const d = drive({ gws: s.gateways.map(g => g.url), controlUrl: s.control.url, rps: 10 });
  try {
    const a = Date.now(); await sleep(STEADY_MS);
    const steady = okRatio(within(d.obs, a, a + STEADY_MS)); steadyGuard('all calls', steady);
    await s.control.close(); const t0 = Date.now();                       // fault injected: control unreachable
    await sleep(1500);
    const identity = await fetch(`${s.control.url}/v1/identity/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: 'kyc-refresh' }), signal: AbortSignal.timeout(1000) }).then(r => `HTTP ${r.status}`, e => `refused (${(e as any).cause?.code ?? e.message})`);
    const admission = await fetch(`${s.control.url}/v1/admission/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(1000) }).then(r => `HTTP ${r.status}`, e => `refused (${(e as any).cause?.code ?? e.message})`);
    await sleep(OUTAGE_MS - 1500);
    const tR = Date.now();
    control2 = await startControl({ dataDir, port, tickMs: 0 }); const listenMs = Date.now() - tR;
    await sleep(3000);
    const t1 = Date.now(); const post = okRatio(within(d.obs, tR + 1500, t1));
    const idAfter = await fetch(`${control2.url}/v1/identity/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: 'kyc-refresh' }) }).then(r => `HTTP ${r.status}`);
    const outage = within(d.obs, t0, tR);
    const firstStale = outage.filter(o => o.code === 'STALE_POLICY_HIGH_RISK').sort((x, y) => x.t - y.t)[0];
    const mttd = firstStale ? firstStale.t - t0 : null;
    const firstOk = within(d.obs, tR, t1, o => o.risk === 'high' && o.code === 'OK').sort((x, y) => x.t - y.t)[0];
    const mttr = firstOk ? firstOk.t - tR : null;
    const afterStale = outage.filter(o => mttd !== null && o.t - t0 > mttd);
    const low = okRatio(outage.filter(o => o.risk === 'low')), high = outage.filter(o => o.risk === 'high');
    const highAfter = afterStale.filter(o => o.risk === 'high');
    const measured = {
      staleAfterMs: STALE_MS, outageMs: tR - t0, steadySuccess: steady,
      lowRiskDuringOutage: { ...low, codes: codes(outage.filter(o => o.risk === 'low')) },
      highRiskDuringOutage: { calls: high.length, codes: codes(high) },
      highRiskAfterStaleDeniedRatio: highAfter.length ? r4(highAfter.filter(o => o.code === 'STALE_POLICY_HIGH_RISK').length / highAfter.length) : null,
      allCallsSuccessRatioDuringOutage: okRatio(outage).ratio,
      mttdMs: mttd, mttrMs: mttr, controlListenMs: listenMs,
      newIdentityDuringOutage: identity, newAdmissionDuringOutage: admission, newIdentityAfterRestart: idAfter,
      postRecoverySuccess: post, agentsRestarted: false, gatewaysRestarted: false,
    } as Record<string, unknown>;
    await d.stop(); await control2.close(); await s.close();
    measured.receiptChain = verifyChain(join(dataDir, 'receipts', 'gw-1.jsonl'));
    const held = low.ratio === 1 && measured.highRiskAfterStaleDeniedRatio === 1 && mttd !== null && mttd <= STALE_MS + 500 && mttr !== null && post.ratio === 1 && identity.startsWith('refused') && admission.startsWith('refused') && idAfter === 'HTTP 200' && (measured.receiptChain as { ok: boolean }).ok;
    console.log(`   low-risk ${low.ratio} MTTD ${mttd} ms MTTR ${mttr} ms`);
    return { measured, held };
  } finally { await d.stop(); await control2?.close(); await s.close(); }
});

// ---------------------------------------------------------------- (b) identity issuer down (token endpoint of control fails; bundle and events still work)
const TTL_MS = 3000;
const issuerDown = () => guarded(meta({
  id: 'identity-issuer-down', title: 'Identity issuer (control token endpoint) fails, then recovers',
  hypothesis: `Tokens issued before the fault keep working until their own expiry (TTL ${TTL_MS} ms, test setting); renewals fail; after expiry every call is denied UNAUTHENTICATED, and no call is allowed on an expired token. When the issuer returns, agents renew and are allowed again without a restart.`,
  steadyState: 'All three agents hold a valid token (renewing at half TTL) and succeed at least 0.99 for 4 s.',
  blastRadius: 'One in-process stack with 1 gateway reaching control through a fault proxy that fails only POST /v1/identity/token with 503. Bundle polling and event push are untouched.',
  abortCondition: 'Steady-state success ratio below 0.99 before injection: no fault is injected. Fault is capped at 8 s.',
  recovery: 'Proxy stops failing the token endpoint. Agents renew on their next call.',
}), async () => {
  const h = await proxiedGateway({ ttlMs: TTL_MS });
  const d = drive({ gws: [h.gw.url], controlUrl: h.proxy.url, rps: 10 });
  try {
    const a = Date.now(); await sleep(4000);
    steadyGuard('all calls', okRatio(within(d.obs, a, Date.now())));
    const expAt = Object.fromEntries([...d.tok].map(([k, v]) => [k, v.exp]));
    const renewFailBefore = d.renew.fail;
    h.proxy.f.issuerDown = true; const t0 = Date.now();
    await sleep(8000);
    const t1 = Date.now(); h.proxy.f.issuerDown = false;
    await sleep(2500);
    const end = Date.now();
    const per = PLAN.map(p => {
      const mine = within(d.obs, t0, t1, o => o.agent === p.id).sort((x, y) => x.t - y.t);
      const firstDeny = mine.find(o => o.code === 'UNAUTHENTICATED');
      const lastAllowBeforeDeny = [...mine].filter(o => o.code === 'OK' && (!firstDeny || o.t < firstDeny.t)).pop();
      const rec = within(d.obs, t1, end, o => o.agent === p.id && o.code === 'OK').sort((x, y) => x.t - y.t)[0];
      const afterExp = mine.filter(o => o.t > expAt[p.id] + 50);
      return {
        agent: p.id, tokenRemainingAtFaultMs: expAt[p.id] - t0, timeToFirstDenialMs: firstDeny ? firstDeny.t - t0 : null,
        lastAllowAfterFaultMs: lastAllowBeforeDeny ? lastAllowBeforeDeny.t - t0 : null,
        allowedAfterTokenExpiry: afterExp.filter(o => o.code === 'OK').length, callsAfterExpiry: afterExp.length,
        deniedCodesAfterFault: codes(mine.filter(o => o.t > expAt[p.id] + 50)), recoveryMs: rec ? rec.t - t1 : null,
      };
    });
    const measured = {
      ttlMs: TTL_MS, faultMs: t1 - t0, renewalsFailedDuringFault: d.renew.fail - renewFailBefore, perAgent: per,
      maxTimeToFirstDenialMs: Math.max(...per.map(p => p.timeToFirstDenialMs ?? Infinity)),
      allowedAfterExpiryTotal: per.reduce((n, p) => n + p.allowedAfterTokenExpiry, 0),
      maxRecoveryMs: Math.max(...per.map(p => p.recoveryMs ?? Infinity)),
    };
    const held = measured.allowedAfterExpiryTotal === 0 && measured.maxTimeToFirstDenialMs <= TTL_MS + 250 && measured.maxRecoveryMs < 2000 && per.every(p => (p.lastAllowAfterFaultMs ?? 0) > 0);
    console.log(`   first denial within ${measured.maxTimeToFirstDenialMs} ms (TTL ${TTL_MS}); allowed after expiry ${measured.allowedAfterExpiryTotal}; recovery ${measured.maxRecoveryMs} ms`);
    return { measured, held };
  } finally { await d.stop(); await h.close(); }
});

// ---------------------------------------------------------------- (c) kill one of two gateway replicas under fleet traffic
async function gatewayLossRun(failover: boolean) {
  const { s, dataDir } = await quietStack({ gateways: 2, fleet: true, failover });
  try {
    const total = () => Object.values(s.fleet.stats()).reduce((m, x) => ({ calls: m.calls + x.calls, errors: m.errors + x.errors, allow: m.allow + x.allow }), { calls: 0, errors: 0, allow: 0 });
    const samples: { t: number; calls: number; errors: number; allow: number }[] = [];
    const timer = setInterval(() => samples.push({ t: Date.now(), ...total() }), 50);
    await sleep(3000);
    const pre = samples[samples.length - 1], steadyErr = pre.errors / pre.calls;
    if (steadyErr > 0.01) throw new Abort(`steady-state transport error rate ${r4(steadyErr)} before injection`);
    const killed = s.gateways[1]; await killed.close(); const t0 = Date.now();
    await sleep(5000); clearInterval(timer);
    const win = samples.filter(x => x.t >= t0), first = samples.filter(x => x.t < t0).pop()!, last = win[win.length - 1];
    const lastErrorT = [...win].reverse().find((x, i, arr) => i + 1 < arr.length && x.errors > arr[i + 1].errors);
    const errs = last.errors - first.errors, calls = last.calls - first.calls;
    await s.close();
    return {
      failover, steadyErrorRate: r4(steadyErr), errorRateAfterLoss: r4(errs / calls), callsAfterLoss: calls, errorsAfterLoss: errs,
      allowRatioAfterLoss: r4((last.allow - first.allow) / calls),
      lastErrorMsAfterLoss: errs ? (lastErrorT ? lastErrorT.t - t0 : null) : 0,
      recovered: failover ? (errs > 0 ? 'errors stop shortly after loss (in-flight and first refused calls only)' : 'no errors') : 'no: errors continue for as long as the replica is down',
      receiptChains: { 'gw-1': verifyChain(join(dataDir, 'receipts', 'gw-1.jsonl')), 'gw-2 (killed)': verifyChain(join(dataDir, 'receipts', 'gw-2.jsonl')) },
    };
  } finally { await s.close(); }
}
const gatewayLoss = () => guarded(meta({
  id: 'gateway-replica-loss', title: 'One of two gateway replicas is killed mid-traffic',
  hypothesis: 'With two replicas and agent-side failover, killing one replica causes at most a handful of transport errors (calls in flight), and the fleet keeps succeeding on the other replica. Without failover (the behaviour before this game day), about half of all calls fail until the replica returns.',
  steadyState: 'The 12-agent fleet (about 17 calls/s) runs over 2 gateways with transport error rate at most 0.01 for 3 s.',
  blastRadius: 'One in-process stack: 1 control, 2 gateways, 12 simulated agents. gw-2 is closed (graceful close, so its receipt chain is flushed).',
  abortCondition: 'Steady-state transport error rate above 0.01 before injection: no fault is injected. Fault is observed for 5 s.',
  recovery: 'No replica restart in this run. Recovery means the fleet failing over to gw-1; failover only on ECONNREFUSED, so a request in flight when a replica dies is not retried (no repeated actions).',
}), async () => {
  const without = await gatewayLossRun(false), withF = await gatewayLossRun(true);
  const held = withF.errorRateAfterLoss <= 0.01 && without.errorRateAfterLoss > 0.2;
  console.log(`   error rate after loss: without failover ${without.errorRateAfterLoss}, with failover ${withF.errorRateAfterLoss}`);
  return { measured: { withoutFailover: without, withFailover: withF, finding: 'The fleet had no gateway failover: its round-robin picked a dead replica for about half of all calls. Fixed in sim/fleet.ts (retry the next replica on ECONNREFUSED only). The without-failover run is the pre-fix behaviour, kept as a measured control.' }, held };
});

// ---------------------------------------------------------------- (d) bad bundle
const badBundle = () => guarded(meta({
  id: 'bad-policy-bundle', title: 'Control serves a malformed or rejected bundle',
  hypothesis: 'A bundle that is not valid JSON, is an HTTP error, is empty, or has the wrong shape never replaces the last good bundle: the gateway keeps the same bundle version, low-risk calls keep succeeding, and high-risk tools fail closed only by the normal staleness rule (a bad bundle does not count as fresh).',
  steadyState: 'Low-risk and high-risk calls succeed at least 0.99 for 2 s with a good bundle.',
  blastRadius: 'One in-process stack, 1 gateway reaching control through a fault proxy that replaces only GET /v1/bundle.',
  abortCondition: 'Steady-state success ratio below 0.99 before injection: no fault is injected. Each variant runs 4 s.',
  recovery: 'Proxy serves the real bundle again; the gateway accepts it on the next poll.',
}), async () => {
  const h = await proxiedGateway();
  h.s.control.registry.upsert(h.s.control.registry.list()[0]);            // bump the bundle version so "kept the last good version" is observable
  await sleep(600);
  const d = drive({ gws: [h.gw.url], controlUrl: h.proxy.url, rps: 10 });
  try {
    const a = Date.now(); await sleep(2000); steadyGuard('all calls', okRatio(within(d.obs, a, Date.now())));
    const version = async () => ((await (await fetch(`${h.gw.url}/healthz`)).json()) as { bundleVersion: number }).bundleVersion;
    const goodVersion = await version(), results: Record<string, unknown>[] = []; let held = true;
    for (const v of ['garbage', 'http500', 'empty', 'badshape'] as const) {
      const rej0 = metric(await text(`${h.gw.url}/metrics`), 'rollcall_gateway_bundles_rejected_total');
      h.proxy.f.bundle = v; const t0 = Date.now(); await sleep(4000);
      const win = within(d.obs, t0, Date.now()), low = okRatio(win.filter(o => o.risk === 'low')), high = win.filter(o => o.risk === 'high');
      const firstStale = high.filter(o => o.code === 'STALE_POLICY_HIGH_RISK').sort((x, y) => x.t - y.t)[0];
      const kept = await version(), rej = metric(await text(`${h.gw.url}/metrics`), 'rollcall_gateway_bundles_rejected_total') - rej0;
      h.proxy.f.bundle = 'ok'; const t1 = Date.now(); await sleep(1200);
      const rec = within(d.obs, t1, Date.now(), o => o.risk === 'high' && o.code === 'OK').sort((x, y) => x.t - y.t)[0];
      const row = { variant: v, lowRiskSuccess: low, highRiskCodes: codes(high), highRiskFirstStaleDenialMs: firstStale ? firstStale.t - t0 : null, bundleVersionBefore: goodVersion, bundleVersionDuring: kept, bundlesRejectedByGateway: rej, recoveryToHighRiskOkMs: rec ? rec.t - t1 : null };
      results.push(row);
      held = held && low.ratio === 1 && kept === goodVersion && !!firstStale && firstStale.t - t0 <= STALE_MS + 500 && rec !== undefined;
      console.log(`   ${v}: low-risk ${low.ratio}, version ${goodVersion}->${kept}, rejected ${rej}`);
    }
    const rows = results as { lowRiskSuccess: { ratio: number }; bundleVersionBefore: number; bundleVersionDuring: number; bundlesRejectedByGateway: number }[];
    return { measured: { staleAfterMs: STALE_MS, lowRiskSuccessMin: Math.min(...rows.map(r => r.lowRiskSuccess.ratio)), versionKeptInAllVariants: rows.every(r => r.bundleVersionDuring === r.bundleVersionBefore), bundlesRejectedTotal: rows.reduce((n, r) => n + r.bundlesRejectedByGateway, 0), variants: results, note: 'http500 is an unavailable control, not a malformed bundle, so the gateway does not count it as rejected.' }, held };
  } finally { await d.stop(); await h.close(); }
});

// ---------------------------------------------------------------- (e) telemetry backlog
const MAXQ = 200;
const telemetryBacklog = () => guarded(meta({
  id: 'telemetry-backlog', title: 'Control events endpoint hangs, then returns',
  hypothesis: `With POST /v1/events hanging, the gateway's event buffer stays bounded at ${MAXQ} (test setting), oldest events are dropped and counted, decisions are unaffected (success ratio and decision latency), and after recovery every decision is either delivered to control or counted as dropped.`,
  steadyState: 'Success ratio at least 0.99 and events delivered to control, for 3 s at about 120 calls/s.',
  blastRadius: 'One in-process stack, 1 gateway reaching control through a fault proxy that holds only POST /v1/events (the gateway gives up after 1 s). Receipts are written locally and are not affected.',
  abortCondition: 'Steady-state success ratio below 0.99 before injection: no fault is injected. Fault is held for 5 s.',
  recovery: 'Proxy forwards events again; the gateway drains its buffer in batches of 500 every 100 ms.',
}), async () => {
  const h = await proxiedGateway({ maxQueue: MAXQ });
  const d = drive({ gws: [h.gw.url], controlUrl: h.proxy.url, rps: 40 });
  try {
    const a = Date.now(); await sleep(3000);
    const steadyObs = within(d.obs, a, Date.now()), steady = okRatio(steadyObs); steadyGuard('all calls', steady);
    const steadyP99 = pct(steadyObs.map(o => o.lat), 99);
    const ingested = () => h.s.control.engine.eventsBetween(0, Infinity).length;
    const dropped = async () => metric(await text(`${h.gw.url}/metrics`), 'rollcall_gateway_events_dropped_total');
    h.proxy.f.events = 'slow'; const t0 = Date.now(); await sleep(5000);
    const win = within(d.obs, t0, Date.now()), ok = okRatio(win), p99 = pct(win.map(o => o.lat), 99);
    const droppedDuring = await dropped(), ingestedDuring = ingested();
    h.proxy.f.events = 'ok'; const t1 = Date.now();
    await d.stop();
    const decisions = d.obs.length; let drainMs: number | null = null;
    for (let i = 0; i < 200; i++) { if (ingested() + (await dropped()) === decisions) { drainMs = Date.now() - t1; break; } await sleep(50); }
    const droppedFinal = await dropped(), ingestedFinal = ingested();
    const measured = {
      maxQueue: MAXQ, faultMs: t1 - t0, steadySuccess: steady, successDuringFault: ok, decisionP99MsSteady: r4(steadyP99), decisionP99MsDuringFault: r4(p99),
      eventsDroppedDuringFault: droppedDuring, eventsDeliveredDuringFault: ingestedDuring, decisionsTotal: decisions, eventsDeliveredFinal: ingestedFinal, eventsDroppedFinal: droppedFinal,
      accountingBalances: ingestedFinal + droppedFinal === decisions, drainMsAfterRecovery: drainMs,
    };
    const held = ok.ratio === 1 && droppedDuring > 0 && measured.accountingBalances && drainMs !== null && p99 < 50;
    console.log(`   success ${ok.ratio}, dropped ${droppedFinal}, delivered ${ingestedFinal}/${decisions}, drain ${drainMs} ms`);
    return { measured, held };
  } finally { await d.stop(); await h.close(); }
});

// ---------------------------------------------------------------- run
const t00 = Date.now();
console.log('chaos: 5 game days, in-process, real control/gateway/fleet code.');
const scenarios = [await controlStop(), await issuerDown(), await gatewayLoss(), await badBundle(), await telemetryBacklog()];
const chaos = {
  command: 'node scripts/chaos.ts', runAt: new Date().toISOString(), durationS: Math.round((Date.now() - t00) / 1000),
  topology: 'in-process: 1 control, 1-2 gateway replicas, mock tools, mini-agents or the 12-agent simulated fleet, all on one laptop-class machine (see environment)',
  settings: { bundleStaleAfterMs: STALE_MS, bundlePollMs: 200, identityTtlMsDefault: 60000, identityTtlMsIssuerGameDay: TTL_MS, eventQueueMaxGameDay: MAXQ },
  scenarios: Object.fromEntries(scenarios.map(s => [s.id, s])),
  allHypothesesHeld: scenarios.every(s => s.hypothesisHeld),
};
mergeImpact({ chaos });
console.log('\n' + scenarios.map(s => `${s.hypothesisHeld ? 'HELD    ' : s.aborted ? 'ABORTED ' : 'FAILED  '}${s.id}`).join('\n'));
console.log(`done in ${chaos.durationS} s; chaos section merged into impact.json`);
process.exit(chaos.allHypothesesHeld ? 0 : 1);
