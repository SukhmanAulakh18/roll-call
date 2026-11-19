import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncidentEvent } from '../../../contracts/types.ts';
import { FLEET } from '../../../sim/fleet.ts';
import { createEngine } from './engine.ts';
import { issueToken } from './identity.ts';
import { createRegistry } from './registry.ts';

/** A "gateway" whose answer to the probe we control. */
async function fakeGateway(answer: { verdict: string; code: string }) {
  const srv = http.createServer((_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...answer, receiptId: 'fake:1' })); });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as any).port}`, close: () => new Promise(r => srv.close(r)) };
}
const killWith = async (gateways: string[]): Promise<IncidentEvent> => {
  const reg = createRegistry(mkdtempSync(join(tmpdir(), 'rc-eng-')), FLEET);
  const e = createEngine({ registry: reg, clock: Date.now, publish: () => {}, runtime: () => undefined, gateways: () => gateways, acks: () => ({}), lastToken: () => undefined, mintToken: (id, t) => issueToken(id, t, Date.now()).token });
  return e.kill('invoice-recon', 'test');
};

test('kill: probe that gets DENY (REVOKED) is proof', async () => {
  const g = await fakeGateway({ verdict: 'deny', code: 'REVOKED' });
  try { assert.equal((await killWith([g.url])).stage, 'proof'); } finally { await g.close(); }
});

test('kill: probe that is ALLOWED is kill_unconfirmed, not proof', async () => {
  const g = await fakeGateway({ verdict: 'allow', code: 'OK' });
  try { const ev = await killWith([g.url]); assert.equal(ev.stage, 'kill_unconfirmed'); assert.equal(ev.proof?.verdict, 'allow'); } finally { await g.close(); }
});

test('kill: denied for some other reason (not REVOKED) is not proof, and no reachable gateway is not proof', async () => {
  const g = await fakeGateway({ verdict: 'deny', code: 'SCOPE' });
  try { assert.equal((await killWith([g.url])).stage, 'kill_unconfirmed'); } finally { await g.close(); }
  assert.equal((await killWith(['http://127.0.0.1:1'])).stage, 'kill_unconfirmed');
});
