import test from 'node:test';
import assert from 'node:assert/strict';
import { SIG_HEADER, signToolCall, verifyToolSig } from '../services/lib/toolsig.ts';
import { startTools } from './tools.ts';

test('tool signature: valid, tampered body, wrong secret, wrong tool, stale', () => {
  const b = { agentId: 'a', args: { ticketId: 'T-1', amountCad: 5 } }, now = 1_000_000;
  const sig = signToolCall('refunds.issue', b, 's', now);
  assert.equal(verifyToolSig('refunds.issue', b, sig, 's', now + 1000), true);
  assert.equal(verifyToolSig('refunds.issue', { ...b, args: { ticketId: 'T-1', amountCad: 6 } }, sig, 's', now), false);
  assert.equal(verifyToolSig('refunds.issue', b, sig, 'other', now), false);
  assert.equal(verifyToolSig('payments.transfer', b, sig, 's', now), false);
  assert.equal(verifyToolSig('refunds.issue', b, sig, 's', now + 60_000), false);
  assert.equal(verifyToolSig('refunds.issue', b, undefined, 's', now), false);
});

test('tools server: unsigned and forged calls get 401 and do nothing; signed call works', async () => {
  const t = await startTools({ secret: 's' });
  try {
    const body = { agentId: 'a', args: { ticketId: 'T-1', amountCad: 5 } };
    const call = (h: Record<string, string>) => fetch(`${t.url}/tool/refunds.issue`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
    assert.equal((await call({})).status, 401);
    assert.equal((await call({ [SIG_HEADER]: signToolCall('refunds.issue', body, 'wrong') })).status, 401);
    assert.equal(t.refunds.length, 0); assert.equal(t.rejectedUnsigned, 2);
    assert.equal((await call({ [SIG_HEADER]: signToolCall('refunds.issue', body, 's') })).status, 200);
    assert.equal(t.refunds.length, 1);
  } finally { await t.close(); }
});
