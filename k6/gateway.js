// Open-model load on the governed decision path. Needs a running stack with incident detection off, otherwise the
// detector (correctly) throttles the load as a runaway agent:  RC_TICK_MS=0 make stack   then   make k6
// Env: RATE (req/s, default 1000), DURATION (default 60s), CONTROL, GATEWAY, AGENT.
import http from 'k6/http';
import { check } from 'k6';

const CONTROL = __ENV.CONTROL || 'http://127.0.0.1:7100', GATEWAY = __ENV.GATEWAY || 'http://127.0.0.1:7200', AGENT = __ENV.AGENT || 'invoice-recon';
const RATE = Number(__ENV.RATE || 1000);
http.setResponseCallback(http.expectedStatuses(200)); // 403/429/502 count as failed

export const options = {
  scenarios: {
    act: { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: __ENV.DURATION || '60s', preAllocatedVUs: 100, maxVUs: 500, exec: 'act' },
  },
  thresholds: {
    'http_req_duration{endpoint:act}': ['p(99)<50'],   // end-to-end over HTTP including the mock tool; the in-gateway decision path is a separate, smaller number (make bench)
    'http_req_failed{endpoint:act}': ['rate<0.001'],
    checks: ['rate>0.999'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const mint = () => http.post(`${CONTROL}/v1/identity/token`, JSON.stringify({ agentId: AGENT }), { headers: { 'content-type': 'application/json' }, tags: { endpoint: 'token' } }).json('token');

export function setup() { return { token: mint(), at: Date.now() }; }

let token, at = 0; // per VU; identity tokens live 60 s, so refresh well before that
export function act(d) {
  if (!token) { token = d.token; at = d.at; }
  if (Date.now() - at > 30000) { token = mint(); at = Date.now(); }
  const r = http.post(`${GATEWAY}/v1/act`, JSON.stringify({ agentId: AGENT, tool: 'ledger.read', args: { accountId: String(100000000000 + __ITER) }, taskId: `k${__VU}` }),
    { headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, tags: { endpoint: 'act' } });
  check(r, { 'allowed': x => x.status === 200 && x.json('verdict') === 'allow' });
}
