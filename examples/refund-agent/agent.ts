// Refund Processing Agent: a genuine separate OS process. Start it yourself:
//   node examples/refund-agent/agent.ts --control http://127.0.0.1:7101 --gateway http://127.0.0.1:7102 [--tickets 15] [--fault-file /tmp/fault]
// Works a queue of synthetic tickets: tickets.read -> decide -> refunds.issue, all through the Roll Call gateway.
// Decision: deterministic rules; if OLLAMA_URL is set a local model gets a say (still capped by the rules). No hosted LLM is ever called.
// Fault flag (file content): "overlimit" = one refund far above the limit; "loop" = hammer the same refund forever and keep retrying after a kill.
// One JSON line per call on stdout so a supervisor can audit what the process actually saw.
import { readFileSync } from 'node:fs';
import { IdentityRefused, connect } from '../../sdk/rollcall.ts';
import { AGENT_ID, RECORD } from './record.ts';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const controlUrl = arg('control', process.env.ROLLCALL_CONTROL)!, gatewayUrl = arg('gateway', process.env.ROLLCALL_GATEWAY)!;
const tickets = Number(arg('tickets', '15')), paceMs = Number(arg('pace', '400')), faultFile = arg('fault-file');
if (!controlUrl || !gatewayUrl) { console.error('need --control and --gateway'); process.exit(2); }
const rc = connect({ controlUrl, gatewayUrl, agentId: AGENT_ID });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ ts: Date.now(), ...o }));
const fault = (): string => { try { return faultFile ? readFileSync(faultFile, 'utf8').trim() : ''; } catch { return ''; } };
const LIMIT = 500;   // the agent knows its policy; the gateway enforces it whether or not the agent does

async function decide(amountCad: number): Promise<number> {
  let amt = amountCad <= LIMIT ? amountCad : 0;                       // rules: refund the requested amount only when within policy
  if (process.env.OLLAMA_URL && amt > 0) {
    try {
      const r = await fetch(`${process.env.OLLAMA_URL}/api/generate`, { method: 'POST', body: JSON.stringify({ model: process.env.OLLAMA_MODEL ?? 'llama3.2', stream: false, prompt: `Approved refund ticket for ${amt} CAD, policy limit ${LIMIT} CAD. Answer only APPROVE or DENY.` }), signal: AbortSignal.timeout(3000) });
      if (!/APPROVE/i.test(String((await r.json() as any).response))) amt = 0;
    } catch { /* local model unreachable: rules stand */ }
  }
  return amt;
}
async function call(phase: string, tool: string, args: Record<string, unknown>, taskId?: string) {
  let r;
  try { r = await rc.act(tool, args, { taskId }); }
  catch (e) {   // the control plane refused to issue an identity (killed agents are not re-issued one)
    const code = e instanceof IdentityRefused ? e.code : 'ERR'; log({ event: 'identity_refused', phase, code });
    if (phase === 'legit') process.exit(3);
    return { verdict: 'deny', code, status: 0, sentAt: Date.now(), result: undefined } as Awaited<ReturnType<typeof rc.act>>;
  }
  log({ event: 'call', phase, tool, ticketId: args.ticketId, amountCad: args.amountCad, status: r.status, verdict: r.verdict, code: r.code, sentAt: r.sentAt });
  return r;
}

const reg = await rc.register(RECORD);
log({ event: 'registered', status: reg.status, pid: process.pid });
for (let i = 1; i <= tickets; i++) {
  const ticketId = `T-${1000 + i}`, t = await call('legit', 'tickets.read', { ticketId }, ticketId);
  const want = Number((t.result as any)?.requestedCad ?? 0), amt = t.verdict === 'allow' ? await decide(want) : 0;
  if (amt > 0) await call('legit', 'refunds.issue', { ticketId, amountCad: amt }, ticketId);
  await sleep(paceMs);
}
log({ event: 'queue_done' });

let mode = '', retries = 0, restarts = 0;
for (;;) {
  const f = fault();
  if (f === 'overlimit' && mode !== f) await call('overlimit', 'refunds.issue', { ticketId: 'T-9001', amountCad: 1800 }, 'T-9001');
  else if (f === 'loop') {
    const r = await call('loop', 'refunds.issue', { ticketId: 'T-1001', amountCad: 120 }, 'T-1001');
    if (r.code === 'REVOKED') {   // a stubborn agent: keeps retrying and now and then asks for a fresh identity
      retries++; if (retries % 25 === 0) { try { await rc.getIdentity({ force: true }); log({ event: 'restart', refused: false }); } catch (e) { restarts++; log({ event: 'restart', refused: true, code: (e instanceof IdentityRefused ? e.code : 'ERR') }); } }
      await sleep(40);
    } else await sleep(20);
    mode = f; continue;
  }
  mode = f; await sleep(100);
}
