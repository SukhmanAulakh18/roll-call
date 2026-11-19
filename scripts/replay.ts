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
console.log(`replay bundle ready: ${out}/ (serve it from any static host; open #/replay)`);
