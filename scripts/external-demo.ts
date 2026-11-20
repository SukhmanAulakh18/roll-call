// make external-demo: a GENUINE external agent (examples/refund-agent, its own OS process) is governed by Roll Call.
// Legit refunds -> over-limit attempt -> repeated-refund loop -> throttle, page (simulated), kill -> the process keeps retrying and is denied each time
// -> independent probe -> restart attempt refused. Merges impact.json `external`; writes replay/external-events.json.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamMessage } from '../contracts/types.ts';
import { issueToken } from '../services/control/src/identity.ts';
import { sleep } from '../services/lib/http.ts';
import { startStack } from '../sim/stack.ts';
import { AGENT_ID } from '../examples/refund-agent/record.ts';
import { mergeImpact } from './lib/impact.ts';
import { record } from './lib/record.ts';

const dir = mkdtempSync(join(tmpdir(), 'rollcall-ext-')), faultFile = join(dir, 'fault');
writeFileSync(faultFile, '');
const stack = await startStack({ dataDir: dir, fleet: false, directEnabled: false });
const replay: (StreamMessage & { ts: number })[] = [];
const stop = await record(stack.control.url, replay);

type Line = Record<string, any>;
function launch(extra: string[] = []): { p: ChildProcess; lines: Line[]; exited: Promise<number | null> } {
  const p = spawn(process.execPath, ['examples/refund-agent/agent.ts', '--control', stack.control.url, '--gateway', stack.gateways[0].url, '--fault-file', faultFile, ...extra], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines: Line[] = []; let buf = '';
  p.stdout!.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { try { lines.push(JSON.parse(buf.slice(0, i))); } catch { /* not ours */ } buf = buf.slice(i + 1); } });
  return { p, lines, exited: new Promise(r => p.on('exit', c => r(c))) };
}
const until = async (f: () => boolean, ms: number, what: string) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error(`timeout waiting for ${what}`); await sleep(50); } };

const agent = launch(['--tickets', '15']);
console.log(`external-demo: agent process pid ${agent.p.pid} (this script is pid ${process.pid}); gateway ${stack.gateways[0].url}`);
await until(() => agent.lines.some(l => l.event === 'queue_done'), 40_000, 'agent to finish its legit queue');
const legit = agent.lines.filter(l => l.event === 'call' && l.phase === 'legit' && l.tool === 'refunds.issue');

writeFileSync(faultFile, 'overlimit');
await until(() => agent.lines.some(l => l.phase === 'overlimit'), 10_000, 'over-limit attempt');
const over = agent.lines.find(l => l.phase === 'overlimit')!;
await sleep(500);

const t0 = Date.now(); writeFileSync(faultFile, 'loop');
const incidents = () => stack.control.engine.incidents(AGENT_ID);
await until(() => incidents().some(e => e.stage === 'proof' || e.stage === 'kill_unconfirmed'), 40_000, 'containment');
await sleep(3000);   // the process keeps going: measure what it sees after the kill
const at = (st: string) => incidents().find(e => e.stage === st)?.ts;
const killedTs = at('killed')!, proofTs = at('proof'), revokedAt = stack.control.registry.bundle(Date.now()).revoked[AGENT_ID];
const calls = agent.lines.filter(l => l.event === 'call');
const loop = calls.filter(l => l.phase === 'loop');
const afterRevoke = loop.filter(l => l.sentAt >= revokedAt);

// independent probe: a fresh stolen-identity style token minted outside the agent, replayed at the gateway
const probeTok = issueToken(AGENT_ID, 15_000).token;
const probe = await (await fetch(`${stack.gateways[0].url}/v1/act`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${probeTok}` }, body: JSON.stringify({ agentId: AGENT_ID, tool: 'refunds.issue', args: { ticketId: 'T-1001', amountCad: 10 } }) })).json() as any;

// restart: the same agent binary started again must be refused a new identity
const second = launch(['--tickets', '3']); const secondExit = await Promise.race([second.exited, sleep(15_000).then(() => 'timeout' as const)]);
const refusedLine = second.lines.find(l => l.event === 'identity_refused');
const idReq = await fetch(`${stack.control.url}/v1/identity/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: AGENT_ID }) });

const stillAlive = agent.p.exitCode === null;
agent.p.kill('SIGTERM'); second.p.kill('SIGTERM'); stop();
const issued = stack.tools.refunds, loopRefunds = issued.filter(r => r.ticketId === 'T-1001' && r.ts >= t0);
const rel = (ts?: number) => (ts === undefined ? null : ts - t0);
const external = {
  command: 'node scripts/external-demo.ts', agentId: AGENT_ID, agentName: 'Refund Processing Agent', separateProcess: true, agentPid: agent.p.pid, supervisorPid: process.pid,
  decision: process.env.OLLAMA_URL ? 'local model via OLLAMA_URL, capped by rules' : 'deterministic rules (no model)', tools: 'sandbox refunds.issue, tickets.read (synthetic, no money moves)',
  perRefundLimitCad: 500,
  legit: { refundsAttempted: legit.length, allowed: legit.filter(l => l.verdict === 'allow').length },
  overLimit: { attemptedCad: over.amountCad, verdict: over.verdict, code: over.code },
  loop: { calls: loop.length, allowed: loop.filter(l => l.verdict === 'allow').length, throttled: loop.filter(l => l.verdict === 'throttle').length, deniedRevoked: loop.filter(l => l.code === 'REVOKED').length, signal: 'repeat signature (same tool + args) plus rate spike' },
  timeline: { faultStartToDetectedMs: rel(at('detected')), toThrottledMs: rel(at('throttled')), toPagedMs: rel(at('paged')), toOwnerAckMs: rel(at('owner_ack')), toKilledMs: rel(killedTs), toProofMs: rel(proofTs) },
  timeToContainMs: rel(proofTs), simulatedOwnerAckMs: 1000, pagesSimulated: stack.control.engine.pages.filter(p => p.incidentId).length,
  requestsBeforeStop: calls.filter(l => l.sentAt < revokedAt).length, allowedBeforeStop: calls.filter(l => l.sentAt < revokedAt && l.verdict === 'allow').length,
  deniedAfterStop: afterRevoke.filter(l => l.code === 'REVOKED').length, allowedAfterStop: afterRevoke.filter(l => l.verdict === 'allow').length,
  allowedAfterProof: proofTs ? loop.filter(l => l.sentAt > proofTs && l.verdict === 'allow').length : null,
  firstDenialAfterRevokeMs: (() => { const d = afterRevoke.find(l => l.code === 'REVOKED'); return d ? d.ts - revokedAt : null; })(),
  agentStillRunningAfterKill: stillAlive, note: 'Roll Call revokes identity; it does not signal the OS process. The process keeps running and every retry is denied.',
  independentProbe: { verdict: probe.verdict, code: probe.code },
  restart: { exitCode: secondExit, identityRefused: !!refusedLine, code: refusedLine?.code ?? null, controlHttpStatus: idReq.status },
  toolSide: { refundsIssuedTotal: issued.length, maxRefundCad: Math.max(0, ...issued.map(r => r.amountCad)), overLimitReachedTool: issued.filter(r => r.amountCad > 500).length, duplicateRefundsOnLoopTicketBeforeKill: loopRefunds.length, duplicateRefundCadBeforeKill: loopRefunds.reduce((s, r) => s + r.amountCad, 0), unsignedRejected: stack.tools.rejectedUnsigned },
};
await stack.close();
mkdirSync('replay', { recursive: true }); writeFileSync('replay/external-events.json', JSON.stringify(replay));
mergeImpact({ external });
console.log(JSON.stringify(external, null, 1));
const ok = external.overLimit.code === 'OVER_LIMIT' && !!proofTs && external.allowedAfterProof === 0 && external.deniedAfterStop > 0 && external.independentProbe.code === 'REVOKED' && external.restart.identityRefused && stillAlive && external.toolSide.overLimitReachedTool === 0;
console.log(ok ? 'external-demo: PASS' : 'external-demo: FAIL');
process.exit(ok ? 0 : 1);
