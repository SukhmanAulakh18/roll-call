import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Dev default so every role verifies the same tokens offline; override with ROLLCALL_SECRET.
const secret = (): string => process.env.ROLLCALL_SECRET ?? 'rollcall-dev-secret-not-for-production';
const b64 = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
const sign = (body: string): string => createHmac('sha256', secret()).update(body).digest('base64url');
export const spiffeId = (agentId: string): string => `spiffe://rollcall.local/agent/${agentId}`;

export interface IssuedToken { token: string; expiresAt: number; spiffeId: string }
export type Verified = { ok: true; agentId: string; spiffeId: string; expiresAt: number } | { ok: false; reason: string };

export function issueToken(agentId: string, ttlMs = 60_000, now = Date.now()): IssuedToken {
  const expiresAt = now + ttlMs;
  const body = b64(JSON.stringify({ sub: spiffeId(agentId), agentId, iat: now, exp: expiresAt, jti: randomBytes(6).toString('hex') }));
  return { token: `rc1.${body}.${sign(body)}`, expiresAt, spiffeId: spiffeId(agentId) };
}

export function verifyToken(token: string, now = Date.now()): Verified {
  const [v, body, sig] = (token ?? '').split('.');
  if (v !== 'rc1' || !body || !sig) return { ok: false, reason: 'malformed token' };
  const want = Buffer.from(sign(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'bad signature' };
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof p.exp !== 'number' || p.exp <= now) return { ok: false, reason: 'token expired' };
    return { ok: true, agentId: p.agentId, spiffeId: p.sub, expiresAt: p.exp };
  } catch { return { ok: false, reason: 'malformed token' }; }
}
