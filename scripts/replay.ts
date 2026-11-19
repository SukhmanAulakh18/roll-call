// make replay: a self-contained static Replay bundle in dist-replay/ (GitHub Pages ready). UI build + replay/events.json + impact.json + agents.json.
// Open <site>/#/replay. No backend is called: every number comes from the last recorded run.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { FLEET } from '../sim/fleet.ts';

const out = 'dist-replay';
for (const f of ['replay/events.json', 'impact.json']) if (!existsSync(f)) { console.error(`missing ${f}: run 'make drill' first`); process.exit(1); }
rmSync(out, { recursive: true, force: true });
const b = spawnSync('npx', ['vite', 'build', '--outDir', `../${out}`, '--emptyOutDir'], { cwd: 'ui', stdio: 'inherit', env: { ...process.env, VITE_REPLAY_ONLY: '1' } });
if (b.status !== 0) process.exit(b.status ?? 1);
mkdirSync(`${out}/replay`, { recursive: true });
cpSync('replay/events.json', `${out}/replay/events.json`);
cpSync('impact.json', `${out}/replay/impact.json`);
writeFileSync(`${out}/replay/agents.json`, JSON.stringify(FLEET));
writeFileSync(`${out}/.nojekyll`, '');
if (existsSync('docs/media/roll-call-demo.mp4')) { // recorded with `make video` from a real run
  mkdirSync(`${out}/media`, { recursive: true });
  for (const f of ['roll-call-demo.mp4', 'roll-call-poster.png', 'roll-call-tour.mp4']) if (existsSync(`docs/media/${f}`)) cpSync(`docs/media/${f}`, `${out}/media/${f}`);
  writeFileSync(`${out}/video.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Roll Call: demo video</title><style>
:root{color-scheme:light dark;--bg:#f4f7fb;--ink:#0b1f3a;--muted:#4a5b73;--blue:#1f5fbf}
@media (prefers-color-scheme:dark){:root{--bg:#0a1628;--ink:#e8eef8;--muted:#9fb0c8;--blue:#6aa2ff}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px}h1{font-size:clamp(1.5rem,4vw,2.25rem);margin:0 0 4px}
p{color:var(--muted);margin:0 0 16px}video{width:100%;height:auto;border-radius:12px;box-shadow:0 10px 40px rgb(0 0 0/.18);background:#000}
a{color:var(--blue)}footer{margin-top:16px;font-size:.875rem;color:var(--muted)}</style></head><body><main>
<h1>Roll Call: watch a runaway AI agent get stopped, with proof</h1>
<p>Recorded from a real run: the live gateway, a runaway-loop drill with and without controls, then detect, throttle, page, kill and the independent proof.</p>
<video controls playsinline preload="metadata" poster="media/roll-call-poster.png"><source src="media/roll-call-demo.mp4" type="video/mp4"></video>
<h2 style="margin:28px 0 4px">Full walkthrough of the live app (3:45)</h2>
<p>Every screen and every drill on a real running stack: runaway loop, ping-pong, scope drift, bad and good release, kill with proof, admission, registry, spend, engineering, replay.</p>
<video controls playsinline preload="metadata"><source src="media/roll-call-tour.mp4" type="video/mp4"></video>
<p style="margin-top:16px"><a href="./#/replay">Open the interactive replay</a> · <a href="https://github.com/SukhmanAulakh18/roll-call">Source</a></p>
<footer>Simulated fleet · real controls · not affiliated with any company</footer></main></body></html>`);
}
console.log(`replay bundle ready: ${out}/ (serve it from any static host; open #/replay)`);
