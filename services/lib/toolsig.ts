import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJSON, sha256 } from './hash.ts';

// Tool-side enforcement: the gateway signs every call it forwards; sandbox tools reject anything without a valid, fresh signature.
// Dev default so the offline stack works; set ROLLCALL_TOOL_SECRET anywhere real. Header: x-rollcall-sig: "<ts>.<hmac>".
export const SIG_HEADER = 'x-rollcall-sig';
export const SIG_MAX_AGE_MS = 30_000;
export const toolSecret = (): string => process.env.ROLLCALL_TOOL_SECRET ?? 'rollcall-dev-tool-secret-not-for-production';
const mac = (secret: string, ts: number, tool: string, body: unknown): string => createHmac('sha256', secret).update(`${ts}.${tool}.${sha256(canonicalJSON(body))}`).digest('hex');
export const signToolCall = (tool: string, body: unknown, secret = toolSecret(), now = Date.now()): string => `${now}.${mac(secret, now, tool, body)}`;
export function verifyToolSig(tool: string, body: unknown, header: string | undefined, secret = toolSecret(), now = Date.now()): boolean {
  const [ts, sig] = (header ?? '').split('.'); const t = Number(ts);
  if (!sig || !Number.isFinite(t) || Math.abs(now - t) > SIG_MAX_AGE_MS) return false;
  const want = Buffer.from(mac(secret, t, tool, body)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
