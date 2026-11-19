import { createHash } from 'node:crypto';
export function canonicalJSON(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonicalJSON(o[k])).join(',') + '}';
}
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const argsHash = (args: unknown): string => sha256(canonicalJSON(args ?? {})).slice(0, 16);
export const PROBE_ARGS_HASH = argsHash({ probe: true });
