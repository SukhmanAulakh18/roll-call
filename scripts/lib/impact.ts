import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';

export const PRICE_ASSUMPTIONS = async () => {
  const { PRICES } = await import('../../contracts/prices.ts');
  return {
    label: 'ASSUMPTIONS, not measurements. Prices are illustrative; edit contracts/prices.ts to change them.',
    pricesUsdPerCall: PRICES,
    llmTokenPricesUsdPer1k: { input: PRICES['llm.in.per1k'], output: PRICES['llm.out.per1k'] },
    llmCompletions: 'Recorded responses from sim/recorded-llm.json; token counts are pre-written approximations.',
    simulatedPager: 'Pager and owner acknowledgement (auto-ack after ~1 s) are simulated; no real page is sent.',
  };
};

export function sha(): string { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } }

/** Section-level merge: replaces the sections given, keeps everything else (bench, chaos, ...). */
export function mergeImpact(patch: Record<string, unknown>, file = 'impact.json'): void {
  const cur = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const next = {
    ...cur, ...patch, generatedAt: new Date().toISOString(), gitSha: sha(),
    environment: { cpu: cpus()[0]?.model, cores: cpus().length, node: process.version, os: `${platform()} ${release()}` },
  };
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
}

/** Nearest-rank percentile. */
export function pct(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
