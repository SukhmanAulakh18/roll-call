// Records the real demo flow (home -> runaway drill -> proof -> admission rejection) from a running stack
// and encodes docs/media/roll-call-demo.mp4 (H.264, web-ready) + a poster PNG. Usage: make video (stack must be up on :7100).
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.argv[2] || 'http://127.0.0.1:7100/';
const OUT = path.resolve('docs/media');
const TMP = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'rc-video-'));
const W = 1600, H = 900;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await fetch(new URL('/v1/reset', BASE), { method: 'POST' }).catch(() => {});
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: TMP, size: { width: W, height: H } } });
  const p = await ctx.newPage();
  const pause = (ms) => p.waitForTimeout(ms);

  await p.goto(BASE); await pause(6000);                                   // business band, live pipeline, the roll
  await p.mouse.wheel(0, 500); await pause(3000); await p.mouse.wheel(0, -500); await pause(1500);
  await p.screenshot({ path: path.join(OUT, 'roll-call-poster.png') });
  const run = p.getByRole('button', { name: /run (a )?drill/i }).first();
  if (await run.count()) await run.click(); else await p.goto(new URL('#/drill', BASE).href);
  await pause(2000);
  if (!/#\/drill/.test(p.url())) await p.goto(new URL('#/drill', BASE).href);
  const runaway = p.getByRole('button', { name: /run runaway loop/i }).first();
  if (await runaway.count() && await runaway.isEnabled()) await runaway.click();
  await pause(42000);                                                       // A/B race, detect -> throttle -> page -> kill -> proof
  await p.mouse.wheel(0, 700); await pause(4000);
  await p.goto(new URL('#/admission', BASE).href); await pause(2000);
  const tryBtn = p.getByRole('button', { name: /try to deploy|deploy/i }).first();
  if (await tryBtn.count()) { await tryBtn.click(); await pause(4000); }

  const video = p.video();
  await ctx.close(); await b.close();
  const webm = await video.path();
  const mp4 = path.join(OUT, 'roll-call-demo.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '26',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4]);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`wrote ${mp4} (${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB) and roll-call-poster.png`);
})().catch((e) => { console.error(e); process.exit(1); });
