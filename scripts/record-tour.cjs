// Full walkthrough of the LIVE app (every screen, every drill, kill with proof, admission, promote) -> docs/media/roll-call-tour.mp4
// Usage: make tour (stack must be up on :7100 via `make demo`).
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const BASE = process.argv[2] || 'http://127.0.0.1:7100/';
const OUT = path.resolve('docs/media'), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-tour-'));
const W = 1600, H = 900;
const go = (p, hash) => p.goto(new URL(hash, BASE).href);
const reset = () => fetch(new URL('/v1/reset', BASE), { method: 'POST' }).catch(() => {});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await reset();
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: TMP, size: { width: W, height: H } } });
  const p = await ctx.newPage();
  const wait = (ms) => p.waitForTimeout(ms);
  const click = async (re, role = 'button') => { const l = p.getByRole(role, { name: re }).first(); if (await l.count()) { await l.click().catch(() => {}); return true; } return false; };
  const scroll = async (dy, ms = 2500) => { await p.mouse.wheel(0, dy); await wait(ms); };

  // 1. Home: business case, live pipeline, the roll
  await go(p, '#/'); await wait(6000); await scroll(600, 4000); await scroll(700, 4000); await scroll(-1300, 1500);
  // 2. Drills: runaway (A/B), ping-pong, scope drift, bad release, good release
  for (const [card, btn, ms] of [[/runaway loop/i, /run runaway/i, 42000], [/ping-pong/i, /run .*ping/i, 22000], [/scope drift/i, /run .*scope/i, 22000], [/bad release/i, /run bad release/i, 22000], [/good release/i, /run good release/i, 20000]]) {
    await reset(); await go(p, '#/drill'); await wait(1500);
    await p.getByText(card).first().click().catch(() => {}); await wait(800);
    if (!(await click(btn))) await click(/^run /i);
    await wait(ms); await scroll(700, 3500); await scroll(-700, 800);
  }
  // 3. Kill with proof from an agent record
  await reset(); await go(p, '#/agent/fraud-triage'); await wait(3000);
  if (await click(/kill/i)) { await wait(1200); const hold = p.getByRole('button', { name: /hold|confirm|kill/i }).last(); await hold.focus().catch(() => {}); await p.keyboard.press('Enter'); await wait(400); await p.keyboard.press('Enter'); await wait(6000); }
  // 4. Admission: unregistered rejected, registered admitted
  await go(p, '#/admission'); await wait(2000);
  await click(/unregistered|shadow/i); await wait(600); await click(/try to deploy/i); await wait(4000);
  await click(/^registered agent/i); await wait(600); await click(/try to deploy/i); await wait(4000);
  // 5. Registry + promotion gates
  await go(p, '#/registry'); await wait(3000); await click(/promote/i); await wait(4000); await p.keyboard.press('Escape');
  // 6. Spend & value, Engineering, Replay
  await go(p, '#/money'); await wait(4000); await scroll(700, 3000);
  await go(p, '#/engineering'); await wait(4000); await scroll(800, 3500);
  await go(p, '#/replay'); await wait(1500); await click(/play/i); await wait(9000);
  await reset();

  const v = p.video(); await ctx.close(); await b.close();
  const mp4 = path.join(OUT, 'roll-call-tour.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', await v.path(), '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4]);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`wrote ${mp4} (${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB)`);
})().catch((e) => { console.error(e); process.exit(1); });
