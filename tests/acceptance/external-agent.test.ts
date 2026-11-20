import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStack } from '../../sim/stack.ts';
import { sleep } from '../../services/lib/http.ts';
import { AGENT_ID } from '../../examples/refund-agent/record.ts';

// A genuine external process (its own `node` command) keeps calling after the kill; every call after proof is denied REVOKED.
test('external refund agent process is denied after kill and keeps running', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-ext-')), fault = join(dir, 'fault'); writeFileSync(fault, '');
  const s = await startStack({ dataDir: dir, fleet: false, tickMs: 0, directEnabled: false });
  const p = spawn(process.execPath, ['examples/refund-agent/agent.ts', '--control', s.control.url, '--gateway', s.gateways[0].url, '--fault-file', fault, '--tickets', '3', '--pace', '100'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines: any[] = []; let buf = '';
  p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { try { lines.push(JSON.parse(buf.slice(0, i))); } catch { /* ignore */ } buf = buf.slice(i + 1); } });
  try {
    assert.notEqual(p.pid, process.pid);
    const t0 = Date.now(); while (!lines.some(l => l.event === 'queue_done')) { assert.ok(Date.now() - t0 < 20_000, 'agent queue did not finish'); await sleep(50); }
    assert.ok(lines.some(l => l.phase === 'legit' && l.tool === 'refunds.issue' && l.verdict === 'allow'), 'legit refunds are allowed');
    writeFileSync(fault, 'loop'); await sleep(400);
    const k = await fetch(`${s.control.url}/v1/agents/${AGENT_ID}/kill`, { method: 'POST', body: '{}' });
    assert.equal(k.status, 200, 'kill proven');
    const proofTs = s.control.engine.incidents(AGENT_ID).find(e => e.stage === 'proof')!.ts;
    await sleep(1200);
    const after = lines.filter(l => l.event === 'call' && l.sentAt > proofTs);
    assert.ok(after.length >= 5, `agent kept calling after the kill (${after.length})`);
    assert.ok(after.every(l => l.verdict === 'deny' && l.code === 'REVOKED'), 'every call after proof is denied REVOKED');
    assert.equal(p.exitCode, null, 'the process was not stopped by Roll Call');
    assert.equal(s.tools.refunds.filter(r => r.ts > proofTs).length, 0, 'no refund reached the tool after proof');
  } finally { p.kill('SIGTERM'); await s.close(); }
});
