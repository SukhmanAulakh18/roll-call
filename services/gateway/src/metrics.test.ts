import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStack } from '../../../sim/stack.ts';

const j = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(r => r.json() as Promise<any>);
const val = (text: string, re: RegExp) => Number(text.split('\n').find(l => re.test(l))?.split(' ').pop());

test('/metrics: gateway receipts match decisions, agent label bounded, 50 ms bucket; control incident + time-to-contain + unregistered gauge', async () => {
  const s = await startStack({ dataDir: mkdtempSync(join(tmpdir(), 'rc-')), fleet: false, tickMs: 0, pollMs: 50 });
  try {
    const gw = s.gateways[0].url, tok = (await j(`${s.control.url}/v1/identity/token`, { agentId: 'invoice-recon' })).token;
    await j(`${gw}/v1/act`, { agentId: 'invoice-recon', tool: 'ledger.read', args: {} }, { authorization: `Bearer ${tok}` });
    await j(`${gw}/v1/act`, { agentId: 'made-up-agent-1', tool: 'ledger.read', args: {} });
    const g = await (await fetch(`${gw}/metrics`)).text();
    assert.equal(val(g, /^rollcall_gateway_receipts_total/), 2);
    assert.match(g, /agent_decisions_total\{gateway="gw-1",agent="invoice-recon",verdict="allow"\} 1/);
    assert.match(g, /agent="unauthenticated",verdict="deny"/); assert.doesNotMatch(g, /made-up-agent-1/);
    assert.match(g, /decision_seconds_bucket\{gateway="gw-1",le="0.05"\}/);

    await fetch(`${s.control.url}/v1/agents/invoice-recon/kill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const c = await (await fetch(`${s.control.url}/metrics`)).text();
    assert.equal(val(c, /^rollcall_control_time_to_contain_seconds_count/), 1);
    assert.match(c, /incident_events_total\{stage="proof"\} 1/);
    assert.equal(val(c, /^rollcall_control_unregistered_running/), 0);
    assert.ok(val(c, /^rollcall_control_bundle_version/) >= 1);
  } finally { await s.close(); }
});
