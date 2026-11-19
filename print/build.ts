// Builds the A5 leave-behind and the pitch numbers from impact.json.
// Every number on the page is read from impact.json here; none is typed by hand.
// Run: node print/build.ts   (then print/render.ts renders the PDF and PNG)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const impact = JSON.parse(readFileSync(join(root, 'impact.json'), 'utf8'));

// Read a dotted path from impact.json and insist it is a finite number.
function num(path: string): number {
  let v: any = impact;
  for (const k of path.split('.')) {
    if (v == null || !(k in v)) throw new Error(`impact.json is missing ${path}`);
    v = v[k];
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`impact.json ${path} is not a finite number`);
  return v;
}
function str(path: string): string {
  let v: any = impact;
  for (const k of path.split('.')) {
    if (v == null || !(k in v)) throw new Error(`impact.json is missing ${path}`);
    v = v[k];
  }
  if (typeof v !== 'string') throw new Error(`impact.json ${path} is not a string`);
  return v;
}

const wbr = (u: string) => u.replace(/^https:\/\//, '').replace(/([./-])/g, '$1<wbr>');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---- values, all from impact.json ----
const registered = num('fleet.registered');
const running = num('fleet.running');
const unregisteredRunning = num('fleet.unregisteredRunning');
const drillRuns = num('drill.runs');
const protectedTotal = num('drill.spendProtectedUsd.protectedTotal');
const protectedMean = num('drill.spendProtectedUsd.protectedMean');
const containP95Ms = num('drill.timeToContainMs.p95');
const autoP95Ms = num('drill.stagesP95Ms.paged');
const ackMs = num('drill.simulatedOwnerAckMs');
const overheadP99Ms = num('bench.overheadP99Ms');
const decisionP99Ms = num('bench.governed.p99');
const detPrecision = num('detector.precision');
const detRecall = num('detector.recall');
const detRunsPerCase = num('detector.runsPerCase');
const detHardFp = num('detector.fp');
const softRunsWithAlert = num('detector.softOnNegatives.runsWithAlert');
const softRuns = num('detector.softOnNegatives.runs');
const chaosScenarios = Object.keys(impact.chaos?.scenarios ?? {}).length;
if (chaosScenarios === 0) throw new Error('impact.json chaos.scenarios is empty');
const generatedAt = str('generatedAt');
const gitSha = str('gitSha');

const usd = (x: number) => `$${x.toFixed(2)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const stamp = new Date(generatedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const PAGE = 'https://sukhmanaulakh18.github.io/roll-call/';
const REPO = 'https://github.com/SukhmanAulakh18/roll-call';
const qr = (text: string) =>
  QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((s: string) =>
    s.replace(/^<\?xml[^>]*>\s*/, ''),
  );
const [qrReplay, qrRepo] = await Promise.all([qr(PAGE), qr(REPO)]);

const questions: [string, string][] = [
  ['What agents exist?', 'Every agent has an owner, purpose, risk rating and scopes. Unregistered workloads are refused.'],
  ['What can each one touch?', 'Tools and scopes are checked on every call against its own allow-list.'],
  ['What does each one cost, and what value?', 'Every call is recorded and metered against a budget. Prices in the demo are assumptions.'],
  ["Can I stop one right now, and prove it's stopped?", 'A kill revokes its identity, then an outside probe must be refused.'],
];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roll Call leave-behind</title>
<style>
@page { size: A5 portrait; margin: 10mm; }
:root { --ink:#16202a; --muted:#4f5a66; --line:#d5dbe2; --accent:#0d6b68; }
html, body { margin:0; padding:0; background:#ffffff; color:var(--ink);
  font-family: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif; }
.sheet { width:128mm; height:189mm; overflow:hidden; display:flex; flex-direction:column; }
h1 { font-size:28pt; line-height:1; margin:0; color:var(--accent); letter-spacing:-0.01em; }
.one { font-size:13pt; line-height:1.35; margin:3mm 0 0; font-weight:600; }
.rule { height:0; border-top:0.5pt solid var(--line); margin:4mm 0 3.5mm; }
h2 { font-size:9pt; text-transform:uppercase; letter-spacing:0.08em; color:var(--accent); margin:0 0 2mm; }
ol.q { list-style:none; margin:0; padding:0; }
ol.q li { display:flex; gap:3mm; margin:0 0 2.2mm; }
ol.q .n { flex:0 0 5mm; font-size:12pt; font-weight:700; color:var(--accent); line-height:1.2; }
ol.q .t { font-size:11pt; font-weight:700; line-height:1.25; }
ol.q .a { font-size:9.5pt; color:var(--muted); line-height:1.35; margin-top:0.6mm; }
.heroes { display:flex; gap:3mm; margin-top:1mm; }
.hero { flex:1 1 0; border-top:2pt solid var(--accent); padding-top:2mm; }
.hero .v { font-size:21pt; font-weight:700; line-height:1; color:var(--accent); white-space:nowrap; }
.hero .l { font-size:9.5pt; font-weight:700; margin-top:1.6mm; line-height:1.25; }
.hero .s { font-size:8.5pt; color:var(--muted); margin-top:1mm; line-height:1.3; }
.run { font-size:8.5pt; color:var(--muted); margin-top:3mm; }
.qrs { display:flex; gap:6mm; margin-top:4mm; }
.qrb { flex:1 1 0; display:flex; flex-direction:row; gap:3mm; align-items:flex-start; }
.qrb svg { width:24mm; height:24mm; display:block; flex:0 0 24mm; }
.qrb .c { font-size:9.5pt; line-height:1.3; }
.qrb .c b { display:block; font-size:10.5pt; color:var(--ink); }
.qrb .c span { color:var(--muted); font-size:7.5pt; overflow-wrap:anywhere; }
.foot { margin-top:auto; font-size:8.5pt; color:var(--muted); border-top:0.5pt solid var(--line); padding-top:2.5mm; }
</style>
</head>
<body>
<div class="sheet">
  <h1>Roll Call</h1>
  <p class="one">Watches a bank's AI agents and can stop one that goes wrong, with proof.</p>
  <div class="rule"></div>
  <h2>Four questions</h2>
  <ol class="q">
${questions.map(([q, a], i) => `    <li><span class="n">${i + 1}</span><div><div class="t">${esc(q)}</div><div class="a">${esc(a)}</div></div></li>`).join('\n')}
  </ol>
  <div class="rule"></div>
  <h2>Three numbers from the last run</h2>
  <div class="heroes">
    <div class="hero"><div class="v">${registered} / ${running}</div><div class="l">agents under control</div><div class="s">registered / running, with ${unregisteredRunning} running without a record</div></div>
    <div class="hero"><div class="v">${usd(protectedTotal)}</div><div class="l">spend protected</div><div class="s">over ${drillRuns} runs, measured in synthetic drills; prices are assumptions</div></div>
    <div class="hero"><div class="v">${secs(containP95Ms)}</div><div class="l">time to contain, p95</div><div class="s">includes a simulated owner acknowledgement of ${secs(ackMs)}</div></div>
  </div>
  <p class="run">Run ${esc(stamp)} · git ${esc(gitSha)} · generated from impact.json</p>
  <div class="qrs">
    <div class="qrb">${qrReplay}<div class="c"><b>Replay</b>Offline recording of a run<br><span>${wbr(PAGE)}</span></div></div>
    <div class="qrb">${qrRepo}<div class="c"><b>Source</b>The repository<br><span>${wbr(REPO)}</span></div></div>
  </div>
  <div class="foot">Simulated fleet · real controls · not affiliated with any bank</div>
</div>
</body>
</html>
`;
writeFileSync(join(root, 'print', 'leave-behind.html'), html);

// ---- pitch numbers: the only place spoken numbers come from ----
const rows: [string, string, string, string][] = [
  ['agents_registered', String(registered), 'fleet.registered', `${registered} agents registered`],
  ['agents_running', String(running), 'fleet.running', `${running} running`],
  ['agents_unregistered_running', String(unregisteredRunning), 'fleet.unregisteredRunning', `${unregisteredRunning} running without a record`],
  ['drill_runs', String(drillRuns), 'drill.runs', `${drillRuns} runaway drills`],
  ['spend_protected_total', usd(protectedTotal), 'drill.spendProtectedUsd.protectedTotal', `${usd(protectedTotal)} of spend protected across ${drillRuns} synthetic runs (assumed prices)`],
  ['spend_protected_mean', usd(protectedMean), 'drill.spendProtectedUsd.protectedMean', `${usd(protectedMean)} per runaway drill`],
  ['contain_p95', secs(containP95Ms), 'drill.timeToContainMs.p95', `${secs(containP95Ms)} to contain, p95, including a ${secs(ackMs)} simulated owner acknowledgement`],
  ['auto_p95', `${autoP95Ms} ms`, 'drill.stagesP95Ms.paged', `${autoP95Ms} ms to throttle and page automatically, p95 (no human in the loop)`],
  ['owner_ack_simulated', secs(ackMs), 'drill.simulatedOwnerAckMs', `a simulated owner acknowledgement of ${secs(ackMs)}`],
  ['overhead_p99', `${overheadP99Ms.toFixed(2)} ms`, 'bench.overheadP99Ms', overheadP99Ms > 0 ? `${overheadP99Ms.toFixed(2)} ms extra at p99, end to end, loopback, one laptop, no TLS (not production latency)` : `no measurable extra latency at p99 (${overheadP99Ms.toFixed(2)} ms, within run-to-run noise), end to end, loopback, one laptop, no TLS (not production latency)`],
  ['decision_p99', `${decisionP99Ms.toFixed(2)} ms`, 'bench.governed.p99', `${decisionP99Ms.toFixed(2)} ms decision-path p99 (in-process timer)`],
  ['detector_precision', detPrecision.toFixed(2), 'detector.precision', `precision ${detPrecision.toFixed(2)} for hard containment`],
  ['detector_recall', detRecall.toFixed(2), 'detector.recall', `recall ${detRecall.toFixed(2)} for hard containment`],
  ['detector_runs_per_case', String(detRunsPerCase), 'detector.runsPerCase', `${detRunsPerCase} runs per case (small, scripted)`],
  ['detector_hard_false_alarms', String(detHardFp), 'detector.fp', `${detHardFp} hard false alarms`],
  ['soft_alerts_on_negatives', `${softRunsWithAlert} of ${softRuns}`, 'detector.softOnNegatives', `soft alerts in ${softRunsWithAlert} of ${softRuns} negative-case runs`],
  ['chaos_game_days', String(chaosScenarios), 'chaos.scenarios', `${chaosScenarios} game days (control stop, issuer down, gateway loss, bad bundle, event backlog)`],
  ['generated_at', stamp, 'generatedAt', `run ${stamp}`],
  ['git_sha', gitSha, 'gitSha', `git ${gitSha}`],
];
const md = `# Pitch numbers

Generated by \`node print/build.ts\` from impact.json. Do not edit by hand; rerun the build.
Spoken forms are in the last column. Use the key in double angle brackets in \`docs/pitch.md\`, for example \`<<contain_p95>>\`.

| Key | Value | Field in impact.json | Spoken form |
|---|---|---|---|
${rows.map(([k, v, f, s]) => `| \`${k}\` | ${v} | \`${f}\` | ${s} |`).join('\n')}

Labels that must stay with the numbers: overhead is an end-to-end difference of two p99s, not decision latency; time to contain includes a simulated owner acknowledgement; detector figures are for hard containment only, on small scripted runs; prices are assumptions.
`;
writeFileSync(join(root, 'print', 'pitch-numbers.md'), md);
console.log(`wrote print/leave-behind.html and print/pitch-numbers.md (${rows.length} keys, run ${stamp}, git ${gitSha})`);
