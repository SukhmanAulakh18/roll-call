// Roll Call client for any external agent process. Zero deps: Node 22 fetch only.
//   const rc = connect({ controlUrl, gatewayUrl, agentId });
//   await rc.register(record);                       // optional: self-onboard (admission rules apply)
//   const r = await rc.act('refunds.issue', { ticketId: 'T-1', amountCad: 40 });   // r.verdict is 'allow' | 'deny' | 'throttle'
import type { ActResponse, AgentRecord } from '../contracts/types.ts';

export interface Identity { token: string; expiresAt: number; spiffeId: string }
export type ActResult = ActResponse & { status: number; sentAt: number; recvAt: number };
/** Thrown when the control plane refuses an identity (REVOKED, UNREGISTERED, RETIRED). */
export class IdentityRefused extends Error { code: string; status: number; constructor(code: string, status: number, msg: string) { super(msg); this.code = code; this.status = status; } }

export function connect(o: { controlUrl: string; gatewayUrl: string; agentId: string }) {
  let id: Identity | null = null;
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });

  async function getIdentity(opts: { force?: boolean } = {}): Promise<Identity> {
    if (id && !opts.force && id.expiresAt - Date.now() > 5000) return id;
    const r = await post(`${o.controlUrl}/v1/identity/token`, { agentId: o.agentId }), b = await r.json() as any;
    if (!r.ok) throw new IdentityRefused(b.code ?? 'REFUSED', r.status, b.error ?? `identity refused (${r.status})`);
    return (id = b as Identity);
  }
  /** One governed call. A deny or throttle is a normal return (check .verdict / .code), not an exception. */
  async function act(tool: string, args: Record<string, unknown>, opts: { taskId?: string; token?: string } = {}): Promise<ActResult> {
    const token = opts.token ?? (await getIdentity()).token, sentAt = Date.now();
    const r = await post(`${o.gatewayUrl}/v1/act`, { agentId: o.agentId, tool, args, taskId: opts.taskId }, { authorization: `Bearer ${token}` });
    return { ...(await r.json() as ActResponse), status: r.status, sentAt, recvAt: Date.now() };
  }
  async function register(record: AgentRecord): Promise<{ status: number; body: any }> {
    const r = await post(`${o.controlUrl}/v1/agents`, record); return { status: r.status, body: await r.json() };
  }
  return { agentId: o.agentId, getIdentity, act, register };
}
