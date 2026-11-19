// axe-core on every route, real and fixture mode, both themes. Run with the stack up: make demo (or node scripts/serve.ts --ui ui/dist).
// NODE_PATH=$(npm root -g) node ui/a11y.cjs [baseUrl]
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:7100/';
const ROUTES = ['', 'agent/invoice-recon', 'drill', 'admission', 'money', 'engineering', 'registry', 'replay'];
(async () => {
  const b = await chromium.launch(); let bad = 0, all = 0;
  for (const mode of ['real', 'fixture']) for (const theme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('rc.theme', JSON.stringify(t)); } catch {} }, theme);
    const p = await ctx.newPage();
    for (const r of ROUTES) {
      await p.goto(`${BASE}${mode === 'fixture' ? '?fixture=1' : ''}#/${r}`); await p.waitForTimeout(r === '' ? 3500 : 2000);
      await p.reload(); await p.waitForTimeout(r === '' ? 3500 : 2000);
      const res = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      for (const v of res.violations) { all++; if (v.impact === 'serious' || v.impact === 'critical') bad++; console.log(`${mode}/${theme} #/${r}: [${v.impact}] ${v.id} x${v.nodes.length} ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`); }
    }
    await ctx.close();
  }
  console.log(`axe: ${all} violations, ${bad} serious or critical`); await b.close(); process.exit(bad ? 1 : 0);
})();
