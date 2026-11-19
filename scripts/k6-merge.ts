// Merges k6/summary.json (from `make k6`) into impact.json under bench.k6. Numbers are copied, never computed by hand.
import { readFileSync } from 'node:fs';
import { mergeImpact } from './lib/impact.ts';

const m = JSON.parse(readFileSync('k6/summary.json', 'utf8')).metrics;
const d = m['http_req_duration{endpoint:act}'], f = m['http_req_failed{endpoint:act}'], rate = Number(process.env.RATE ?? 1000);
const cur = JSON.parse(readFileSync('impact.json', 'utf8')).bench ?? {};
mergeImpact({
  bench: {
    ...cur,
    k6: {
      command: `RC_TICK_MS=0 make stack; RATE=${rate} make k6 (grafana/k6:1.3.0, host network, constant-arrival-rate ${rate}/s for 60 s)`,
      endpoint: 'POST /v1/act ledger.read, end to end over HTTP (includes the mock tool), incident detection off, fleet simulator running in the same process',
      p50Ms: d.med, p95Ms: d['p(95)'], p99Ms: d['p(99)'], maxMs: d.max,
      rps: m.iterations.rate, requests: m.iterations.count, errorRate: f.value, checksPassRate: m.checks.value,
      targetP99Ms: 50, targetNote: 'threshold p(99)<50 ms on http_req_duration{endpoint:act}; a target, not a result',
    },
  },
});
