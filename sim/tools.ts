import http from 'node:http';
import { readFileSync } from 'node:fs';
import { canonicalJSON, sha256 } from '../services/lib/hash.ts';
import { closeServer, createRouter, fail, listen, ok } from '../services/lib/http.ts';

const LLM = JSON.parse(readFileSync(new URL('./recorded-llm.json', import.meta.url), 'utf8')).completions as
  { id: string; text: string; inputTokens: number; outputTokens: number }[];
const h = (v: unknown): number => parseInt(sha256(canonicalJSON(v)).slice(0, 8), 16);
const s = (v: unknown): string => String(v ?? '');

type ToolFn = (args: any, ctx: { agentId?: string; targetAgentId?: string }) => { result: unknown; usage?: { inputTokens: number; outputTokens: number } };

/** Deterministic mock bank tools: same args => same result. No real data; account numbers are synthetic digits. */
export const TOOLS: Record<string, ToolFn> = {
  'ledger.read': a => ({ result: { accountNumber: String(100000000000 + (h(a) % 899999999999)), balance: (h([a, 1]) % 5_000_000) / 100, currency: 'CAD' } }),
  'ledger.post': a => ({ result: { postingId: `PST-${h(a).toString(16)}`, status: 'posted-sim' } }),
  'txn.lookup': a => ({ result: { txn: s(a.txn ?? a.id), amount: (h(a) % 900_000) / 100, merchantCategory: ['grocery', 'travel', 'electronics', 'fuel'][h(a) % 4], payerAccount: String(200000000000 + (h([a, 2]) % 799999999999)) } }),
  'kyc.lookup': a => ({ result: { customer: s(a.customer), status: ['verified', 'refresh-due', 'pending'][h(a) % 3], lastReview: `2026-0${1 + (h(a) % 9)}-1${h(a) % 9}` } }),
  'docs.search': a => ({ result: { hits: [0, 1, 2].map(i => ({ id: `DOC-${(h([a, i]) % 9000) + 1000}`, title: `Policy section ${(h([a, i]) % 40) + 1}` })) } }),
  'llm.complete': a => {
    const c = LLM[h(a.prompt ?? a) % LLM.length];
    return { result: { completionId: c.id, text: c.text, recorded: true }, usage: { inputTokens: c.inputTokens, outputTokens: c.outputTokens } };
  },
  'payments.transfer': a => ({ result: { transferId: `TX-${h(a).toString(16)}`, status: 'accepted-sim', amount: a.amount } }),
  'fraud.flag': a => ({ result: { flagId: `FL-${h(a).toString(16)}`, status: 'flagged-sim' } }),
  'agent.call': (_a, ctx) => ({ result: { delivered: true, from: ctx.agentId, to: ctx.targetAgentId } }),
  'limits.get': a => ({ result: { segment: s(a.segment), approvedLimit: 1_000_000 + (h(a) % 9) * 250_000, currency: 'CAD' } }),
  'mail.send': a => ({ result: { messageId: `MSG-${h(a).toString(16)}`, status: 'queued-sim' } }),
};

/** Mock tool server. approvals.enqueue is the human-in-the-loop queue: nothing leaves it without a person. */
export async function startTools(opts: { port?: number; host?: string } = {}): Promise<{ url: string; close(): Promise<void>; approvals: unknown[] }> {
  const approvals: { queueId: string; agentId?: string; status: string; item: unknown }[] = [];
  const r = createRouter();
  r.add('POST', '/tool/:name', async c => {
    const b = await c.json(); const name = c.params.name;
    if (name === 'approvals.enqueue') {
      const q = { queueId: `APR-${approvals.length + 1}`, agentId: b.agentId, status: 'pending-human-approval', item: b.args };
      approvals.push(q); if (approvals.length > 5000) approvals.shift();
      return ok({ result: { queueId: q.queueId, status: q.status } });
    }
    if (name === 'ledger.read' && b.args?.accountId === '') return fail(422, 'accountId must not be empty');
    const fn = TOOLS[name]; if (!fn) return fail(404, `unknown tool '${name}'`);
    return ok(fn(b.args ?? {}, { agentId: b.agentId, targetAgentId: b.targetAgentId }));
  });
  r.add('GET', '/approvals', () => ok(approvals.slice(-100)));
  r.add('GET', '/healthz', () => ok({ ok: true }));
  const server = http.createServer(async (req, res) => { if (!(await r.handle(req, res))) { res.writeHead(404); res.end(); } });
  const url = await listen(server, opts.port ?? 0, opts.host);
  let closed = false;
  return { url, approvals, async close() { if (closed) return; closed = true; await closeServer(server); } };
}
