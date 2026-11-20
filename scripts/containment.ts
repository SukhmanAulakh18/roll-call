// make containment: harder containment tests against the real gateway/control/tools, run through the SDK. Failures are recorded, never hidden.
// Merges impact.json `containment`. Sizes: --runs (concurrency/in-flight/false-positive repeats).
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { connect } from '../sdk/rollcall.ts';
import type { ActResult } from '../sdk/rollcall.ts';
import { startControl } from '../services/control/src/app.ts';
import { startGateway } from '../services/gateway/src/app.ts';
import { closeServer, listen, sleep } from '../services/lib/http.ts';
import { SIG_HEADER, signToolCall } from '../services/lib/toolsig.ts';
import { canonicalJSON, sha256 } from '../services/lib/hash.ts';
import { startStack } from '../sim/stack.ts';
import { startTools } from '../sim/tools.ts';
import { AGENT_ID, RECORD } from '../examples/refund-agent/record.ts';
import { mergeImpact, pct } from './lib/impact.ts';

const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const RUNS = arg('runs', 15), FP_RUNS = arg('fp-runs', 10);
const tmp = () => mkdtempSync(join(tmpdir(), 'rollcall-cont-'));
const j = async (url: string, body: unknown, headers: Record<string, string> = {}) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as any }; };
const dist = (xs: number[]) => xs.length ? { p50: Math.round(pct(xs, 50)), p95: Math.round(pct(xs, 95)), p99: Math.round(pct(xs, 99)), max: Math.max(...xs), n: xs.length } : null;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

async function boot(o: { tickMs?: number } = {}) {
  const s = await startStack({ dataDir: tmp(), fleet: false, tickMs: o.tickMs ?? 0, directEnabled: false });
  const rc = connect({ controlUrl: s.control.url, gatewayUrl: s.gateways[0].url, agentId: AGENT_ID });
  await rc.register(RECORD); await sleep(450);   // gateway polls the bundle every 200 ms
  return { s, rc, kill: () => j(`${s.control.url}/v1/agents/${AGENT_ID}/kill`, { reason: 'containment test' }) };
}
type Test = { id: string; name: string; n: number; passed: number; failed: number; pass: boolean; [k: string]: unknown };
const mk = (id: string, name: string, n: number, passed: number, extra: Record<string, unknown> = {}): Test => ({ id, name, n, passed, failed: n - passed, pass: passed === n, ...extra });
const tests: Test[] = [];
const t00 = Date.now();

// ---- (a) concurrency: 200 in-flight requests from the agent while the kill fires
{
  const lag: number[] = []; let total = 0, okRuns = 0, allowedBefore = 0, allowedLagWindow = 0, deniedAfter = 0, violations = 0, errors = 0;
  for (let i = 0; i < RUNS; i++) {
    const { s, rc, kill } = await boot(); const tok = (await rc.getIdentity()).token;
    const recs: ActResult[] = []; let stopF = false, seq = 0;
    const workers = Array.from({ length: 200 }, async () => { while (!stopF) { try { recs.push(await rc.act('refunds.issue', { ticketId: `T-${++seq}`, amountCad: 10 }, { token: tok })); } catch { errors++; } } });
    await sleep(700); const k = await kill(); await sleep(500); stopF = true; await Promise.all(workers);
    const revokedAt = s.control.registry.bundle(Date.now()).revoked[AGENT_ID];
    const firstDeny = Math.min(...recs.filter(r => r.code === 'REVOKED').map(r => r.recvAt));
    const bad = Number.isFinite(firstDeny) ? recs.filter(r => r.verdict === 'allow' && r.sentAt > firstDeny).length : recs.length;
    total += recs.length; allowedBefore += recs.filter(r => r.verdict === 'allow' && r.sentAt < revokedAt).length;
    allowedLagWindow += recs.filter(r => r.verdict === 'allow' && r.sentAt >= revokedAt).length; deniedAfter += recs.filter(r => r.code === 'REVOKED').length; violations += bad;
    if (Number.isFinite(firstDeny)) lag.push(firstDeny - revokedAt);
    if (bad === 0 && Number.isFinite(firstDeny) && k.status === 200) okRuns++;
    await s.close(); console.log(`(a) run ${i + 1}/${RUNS}: ${recs.length} requests, lag ${Number.isFinite(firstDeny) ? firstDeny - revokedAt : 'none'} ms, violations ${bad}`);
  }
  tests.push(mk('concurrency', '200 concurrent requests while the kill fires: none sent after the first denial is allowed', RUNS, okRuns, {
    concurrentWorkers: 200, totalRequests: total, allowedBeforeRevocation: allowedBefore, allowedSentAfterRevocationBeforeGatewayObservedIt: allowedLagWindow, deniedAfterRevocation: deniedAfter,
    allowedAfterFirstDenial: violations, fetchErrors: errors, revokeToFirstDenialMs: dist(lag), gatewayPollMs: 200,
    note: 'n = kill runs; each run has 200 workers looping for ~1.2 s. The lag window is the gateway bundle poll interval; requests sent inside it are allowed and are counted, not hidden.' }));
}

// ---- (b) token replay
{
  const { s, rc, kill } = await boot(); const tok = (await rc.getIdentity()).token;
  const pre = await rc.act('refunds.issue', { ticketId: 'T-1', amountCad: 10 }, { token: tok }); await kill();
  const N = 200, rs: ActResult[] = []; for (let i = 0; i < N / 50; i++) rs.push(...await Promise.all(Array.from({ length: 50 }, (_, k) => rc.act('refunds.issue', { ticketId: `T-${i * 50 + k}`, amountCad: 10 }, { token: tok }))));
  tests.push(mk('token-replay', 'old identity token replayed after the kill is denied (REVOKED)', N, rs.filter(r => r.verdict === 'deny' && r.code === 'REVOKED').length, { tokenWorkedBeforeKill: pre.verdict === 'allow' }));
  await s.close();
}

// ---- (c) bypass: call the tool directly, skipping the gateway
{
  const { s } = await boot(); const tool = 'refunds.issue', body = { agentId: AGENT_ID, args: { ticketId: 'T-1', amountCad: 10 } }, N = 50;
  const forged = (b: unknown, ts = Date.now()) => `${ts}.${createHmac('sha256', 'guessed-secret').update(`${ts}.${tool}.${sha256(canonicalJSON(b))}`).digest('hex')}`;
  const variants: Record<string, () => Record<string, string>> = {
    'no signature': () => ({}),
    'forged signature (wrong secret)': () => ({ [SIG_HEADER]: forged(body) }),
    'garbage signature': () => ({ [SIG_HEADER]: 'abc.def' }),
    'valid signature for a different body (tampered args)': () => ({ [SIG_HEADER]: signToolCall(tool, { agentId: AGENT_ID, args: { ticketId: 'T-1', amountCad: 1 } }) }),
    'captured signature replayed after its freshness window': () => ({ [SIG_HEADER]: signToolCall(tool, body, undefined, Date.now() - 120_000) }),
  };
  const per: Record<string, number> = {}; let okN = 0;
  for (const [name, hdr] of Object.entries(variants)) { let k = 0; for (let i = 0; i < N; i++) { const r = await j(`${s.tools.url}/tool/${tool}`, body, hdr()); if (r.status === 401) k++; } per[name] = k; okN += k; }
  let direct404 = 0; for (let i = 0; i < N; i++) if ((await j(`${s.gateways[0].url}/v1/direct`, { agentId: AGENT_ID, tool, args: body.args })).status === 404) direct404++;
  const control = await j(`${s.tools.url}/tool/${tool}`, body, { [SIG_HEADER]: signToolCall(tool, body) });
  tests.push(mk('bypass', 'direct call to a tool without a valid gateway signature gets 401; /v1/direct is off by default', N * Object.keys(variants).length + N, okN + direct404, {
    toolRejectedByVariant: per, directEndpoint404: direct404, refundsThatReachedTool: s.tools.refunds.length - 1,
    positiveControl: { correctlySignedCallStatus: control.status, note: 'A holder of the shared tool secret CAN call tools: the signature moves trust to the secret, it does not make the tool unreachable.' } }));
  await s.close();
}

// ---- (d) in-flight: a request already past the gateway when the kill lands
{
  const dir = tmp(), tools = await startTools(), arrived = new Set<string>(); const DELAY = 1200;
  const proxy = http.createServer((req, res) => {   // delays the tool so the request is provably past the gateway when the kill lands
    const chunks: Buffer[] = []; req.on('data', c => chunks.push(c as Buffer)); req.on('end', async () => {
      const raw = Buffer.concat(chunks); try { arrived.add(JSON.parse(raw.toString()).agentId); } catch { /* ignore */ }
      await sleep(DELAY); const r = await fetch(tools.url + req.url, { method: 'POST', headers: { 'content-type': 'application/json', [SIG_HEADER]: String(req.headers[SIG_HEADER]) }, body: raw });
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(await r.text());
    });
  });
  const purl = await listen(proxy);
  const control = await startControl({ dataDir: dir, tickMs: 0 }), gw = await startGateway({ controlUrl: control.url, toolsUrl: purl, gatewayId: 'gw-1', dataDir: dir });
  control.setGateways([gw.url]);
  const ids = Array.from({ length: RUNS }, (_, i) => `refund-flight-${i}`);
  for (const id of ids) await j(`${control.url}/v1/agents`, { ...RECORD, id });
  await sleep(450);
  let denied = 0, completed = 0, afterKillDenied = 0;
  await Promise.all(ids.map(async id => {
    const rc = connect({ controlUrl: control.url, gatewayUrl: gw.url, agentId: id }), tok = (await rc.getIdentity()).token;
    const inflight = rc.act('refunds.issue', { ticketId: 'T-77', amountCad: 25 }, { token: tok });
    while (!arrived.has(id)) await sleep(10);
    await j(`${control.url}/v1/agents/${id}/kill`, {});
    const after = await rc.act('refunds.issue', { ticketId: 'T-78', amountCad: 25 }, { token: tok });
    const r = await inflight; if (r.verdict === 'allow') completed++; else denied++; if (after.code === 'REVOKED') afterKillDenied++;
  }));
  tests.push(mk('in-flight', 'request already past the gateway when the kill lands completes (documented boundary); the next request is denied', RUNS, afterKillDenied, {
    inFlightCompleted: completed, inFlightDenied: denied, toolDelayMs: DELAY,
    note: `${completed} of ${RUNS} in-flight requests completed after the kill. This is the guarantee boundary, not a bug: the gateway cannot recall an action it already allowed. passed = the NEXT request after the kill was denied.` }));
  await gw.close(); await control.close(); await tools.close(); await closeServer(proxy);
}

// ---- (e) restart: a killed agent asks for a new identity
{
  const { s, rc, kill } = await boot(); await kill(); const N = 50;
  let refused = 0, reReg = 0;
  for (let i = 0; i < N; i++) { const r = await j(`${s.control.url}/v1/identity/token`, { agentId: AGENT_ID }); if (r.status === 403 && r.body.code === 'REVOKED') refused++; }
  for (let i = 0; i < N; i++) { await rc.register(RECORD); const r = await j(`${s.control.url}/v1/identity/token`, { agentId: AGENT_ID }); if (r.status === 403 && r.body.code === 'REVOKED') reReg++; }
  const fresh = await j(`${s.control.url}/v1/agents`, { ...RECORD, id: `${AGENT_ID}-2`, name: 'Refund Processing Agent (renamed)' });
  const tok2 = await j(`${s.control.url}/v1/identity/token`, { agentId: `${AGENT_ID}-2` });
  tests.push(mk('restart', 'killed agent asking for a new identity (also after re-registering the same id) is refused', 2 * N, refused + reReg, {
    plainRequestRefused: refused, afterReRegistrationRefused: reReg,
    openRegistrationNewIdAccepted: fresh.status === 201 && tok2.status === 200,
    note: 'FINDING: registration (POST /v1/agents) is unauthenticated in this prototype, so a process that can reach control can register a NEW id and get a token for it. Registration needs an owner-approved admission workflow in production.' }));
  await s.close();
}

// ---- (f) argument tampering against the per-refund limit
{
  const { s, rc } = await boot(); const tok = (await rc.getIdentity()).token, REP = 20;
  const V: [string, Record<string, unknown>, string][] = [
    ['amount as string "1000"', { ticketId: 'T-1', amountCad: '1000' }, 'INVALID_ARGS'], ['amount as string "100"', { ticketId: 'T-1', amountCad: '100' }, 'INVALID_ARGS'],
    ['negative -5', { ticketId: 'T-1', amountCad: -5 }, 'INVALID_ARGS'], ['zero', { ticketId: 'T-1', amountCad: 0 }, 'INVALID_ARGS'],
    ['500.01 (one cent over)', { ticketId: 'T-1', amountCad: 500.01 }, 'OVER_LIMIT'], ['1e9', { ticketId: 'T-1', amountCad: 1e9 }, 'OVER_LIMIT'],
    ['fraction of a cent 100.555', { ticketId: 'T-1', amountCad: 100.555 }, 'INVALID_ARGS'], ['null (from Infinity/NaN)', { ticketId: 'T-1', amountCad: null }, 'INVALID_ARGS'],
    ['boolean true', { ticketId: 'T-1', amountCad: true }, 'INVALID_ARGS'], ['array [900]', { ticketId: 'T-1', amountCad: [900] }, 'INVALID_ARGS'],
    ['object {value:900}', { ticketId: 'T-1', amountCad: { value: 900 } }, 'INVALID_ARGS'], ['string "9e2"', { ticketId: 'T-1', amountCad: '9e2' }, 'INVALID_ARGS'],
    ['hex string "0x384"', { ticketId: 'T-1', amountCad: '0x384' }, 'INVALID_ARGS'], ['amount missing', { ticketId: 'T-1' }, 'INVALID_ARGS'],
    ['split into a list of refunds', { refunds: [{ ticketId: 'T-1', amountCad: 300 }, { ticketId: 'T-1', amountCad: 300 }] }, 'INVALID_ARGS'], ['ticketId injection', { ticketId: "T-1'; DROP", amountCad: 10 }, 'INVALID_ARGS'],
  ];
  let passed = 0; const wrong: string[] = [];
  for (const [name, args, want] of V) for (let i = 0; i < REP; i++) { const r = await rc.act('refunds.issue', args, { token: tok }); if (r.verdict === 'deny' && r.code === want) passed++; else if (!wrong.includes(`${name} -> ${r.code}`)) wrong.push(`${name} -> ${r.code}`); }
  const edge = await Promise.all([500, 500.0, 0.01, 499.99].map(a => rc.act('refunds.issue', { ticketId: 'T-2', amountCad: a }, { token: tok })));
  tests.push(mk('arg-tampering', 'over-limit amounts hidden as strings, negatives, floats, containers, splits are denied by arg validation', V.length * REP, passed, {
    variants: V.length, repsPerVariant: REP, unexpected: wrong, boundaryAllowed: edge.map(e => e.verdict),
    refundsThatReachedTool: s.tools.refunds.length, maxRefundCadAtTool: Math.max(0, ...s.tools.refunds.map(r => r.amountCad)),
    note: 'Only the 4 boundary amounts (500, 0.01, 499.99) legitimately reached the tool. NOT covered: many separate in-limit refunds on one ticket (no cumulative per-ticket cap); only the repeat detector and budgets stand in the way.' }));
  await s.close();
}

// ---- (g) false positives: a legitimate high-volume agent with varied tickets
{
  const one = async (i: number) => {
    const { s, rc } = await boot({ tickMs: 250 }); let seq = i * 100_000, allowed = 0, throttled = 0, other = 0;
    const call = async () => { const id = `T-${++seq}`; const r = await rc.act('refunds.issue', { ticketId: id, amountCad: 20 + (seq % 400) }, { taskId: id }); if (r.verdict === 'allow') allowed++; else if (r.verdict === 'throttle') throttled++; else other++; };
    const end1 = Date.now() + 3500; while (Date.now() < end1) { await call(); await sleep(250); }
    const end2 = Date.now() + 4000; await Promise.all([0, 1, 2].map(async () => { while (Date.now() < end2) { await call(); await sleep(70); } }));
    await sleep(600);
    const inc = s.control.engine.incidents(AGENT_ID), hard = inc.some(e => e.stage === 'paged' || e.stage === 'killed') || s.control.registry.isRevoked(AGENT_ID), soft = inc.some(e => e.stage === 'throttled');
    await s.close(); return { allowed, throttled, other, hard, soft };
  };
  const res: Awaited<ReturnType<typeof one>>[] = [];
  for (let b = 0; b < FP_RUNS; b += 5) res.push(...await Promise.all(Array.from({ length: Math.min(5, FP_RUNS - b) }, (_, k) => one(b + k))));
  const calls = sum(res.map(r => r.allowed + r.throttled + r.other));
  tests.push(mk('false-positives', 'legitimate high-volume agent with varied tickets is not hard-contained (no page, no kill)', FP_RUNS, res.filter(r => !r.hard).length, {
    hardContainedRuns: res.filter(r => r.hard).length, softThrottledRuns: res.filter(r => r.soft).length, legitCalls: calls, legitCallsThrottled: sum(res.map(r => r.throttled)), legitCallsDeniedOther: sum(res.map(r => r.other)),
    note: 'Each run: ~4 calls/s for 3.5 s, then ~40 calls/s for 4 s with a new ticket on every call. A burst this far above its own baseline can still draw a SOFT throttle (a slowdown, no page, no kill); those legitimate calls answered 429 are counted above.' }));
}

const containment = {
  command: 'node scripts/containment.ts', runs: RUNS, falsePositiveRuns: FP_RUNS, durationSec: Math.round((Date.now() - t00) / 1000),
  allPassed: tests.every(t => t.pass), tests,
  guarantees: [
    { guaranteed: true, text: 'Once a gateway has observed a revocation, no new protected action goes through that gateway: every later request is denied (REVOKED). Tests: concurrency, token-replay, restart.' },
    { guaranteed: true, text: 'Sandbox tools reject any call that does not carry a fresh gateway HMAC signature (401), so there is no unsigned path around the gateway. Test: bypass.' },
    { guaranteed: true, text: 'Over-limit and malformed refund arguments are denied before the tool is reached (OVER_LIMIT, INVALID_ARGS). Test: arg-tampering.' },
    { guaranteed: false, text: 'Actions already past the gateway when the kill lands. They complete. Test: in-flight.' },
    { guaranteed: false, text: 'Requests sent inside the propagation window (up to the gateway bundle poll interval, 200 ms here) before a gateway has observed the revocation. They are counted in concurrency.' },
    { guaranteed: false, text: 'Actions through paths that do not use the gateway: anyone holding the tool secret, or a tool that does not check signatures, is outside this guarantee.' },
    { guaranteed: false, text: 'Stopping the OS process. Roll Call revokes identity; the process keeps running and keeps being denied.' },
    { guaranteed: false, text: 'Registering a brand-new agent id. Registration is unauthenticated in this prototype (see restart finding).' },
    { guaranteed: false, text: 'Many separate in-limit refunds on one ticket: no cumulative per-ticket cap.' },
  ],
};
mergeImpact({ containment });
for (const t of tests) console.log(`${t.pass ? 'PASS' : 'FAIL'}  ${t.id.padEnd(15)} n=${t.n} passed=${t.passed} failed=${t.failed}`);
console.log(JSON.stringify(tests.find(t => t.id === 'concurrency'), null, 1));
console.log(`containment: ${tests.filter(t => t.pass).length}/${tests.length} tests fully passed (${containment.durationSec} s). Failures, if any, are recorded in impact.json.`);
