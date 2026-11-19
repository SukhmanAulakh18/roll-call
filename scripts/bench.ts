// make bench: gateway decision-path latency (governed /v1/act) vs ungoverned /v1/direct. Merges the `bench` section into impact.json.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStack } from '../sim/stack.ts';
import { mergeImpact, pct } from './lib/impact.ts';

const N = 6000, CONC = 16, agentId = 'invoice-recon';
const s = await startStack({ dataDir: mkdtempSync(join(tmpdir(), 'rollcall-bench-')), fleet: false, tickMs: 0 });
const gw = s.gateways[0].url;
const tok = (await (await fetch(`${s.control.url}/v1/identity/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId }) })).json() as any).token;

async function run(path: string, headers: Record<string, string>) {
  const dec: number[] = [], e2e: number[] = []; let i = 0, bad = 0; const t0 = performance.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < N) {
      const n = i++, a = performance.now();
      const r = await fetch(gw + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ agentId, tool: 'ledger.read', args: { accountId: String(100000000000 + n) }, taskId: `b${n % 50}` }) });
      const b = await r.json() as { latencyMs: number; verdict: string };
      e2e.push(performance.now() - a); dec.push(b.latencyMs); if (b.verdict !== 'allow') bad++;
    }
  }));
  const secs = (performance.now() - t0) / 1000, q = (x: number[]) => ({ p50: pct(x, 50), p95: pct(x, 95), p99: pct(x, 99) });
  return { ...q(dec), endToEnd: q(e2e), rps: N / secs, notAllowed: bad };
}
await run('/v1/act', { authorization: `Bearer ${tok}` }); // warmup
const governed = await run('/v1/act', { authorization: `Bearer ${tok}` });
const direct = await run('/v1/direct', {});
await s.close();
const bench = {
  command: 'node scripts/bench.ts', requests: N, concurrency: CONC, tool: 'ledger.read',
  note: 'p50/p95/p99 are the gateway-reported decision path in ms (excludes tool time). endToEnd includes client + HTTP + mock tool.',
  governed, direct, overheadP99Ms: governed.endToEnd.p99 - direct.endToEnd.p99, throughputRps: governed.rps, targetDecisionP99Ms: 50,
};
mergeImpact({ bench });
console.log(JSON.stringify(bench, null, 1));
