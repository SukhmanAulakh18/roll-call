import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, MarkLineComponent, SVGRenderer]);

/** ECharts cannot parse oklch(), so resolve each design token to rgb through a canvas. */
const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const ctx = cv?.getContext('2d', { willReadFrequently: true }) ?? null;
function resolve(token: string): string {
  const el = document.createElement('span');
  el.style.color = `var(${token})`; document.body.appendChild(el);
  const c = getComputedStyle(el).color; el.remove();
  if (!ctx) return c;
  ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${a / 255})`;
}
export interface Palette { ink: string; ink2: string; muted: string; rule: string; rule2: string; cool: string; accent: string; ok: string; bad: string; paper2: string; font: string; mono: string }
export function usePalette(): Palette {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme);
  useEffect(() => { const o = new MutationObserver(() => setTheme(document.documentElement.dataset.theme)); o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => o.disconnect(); }, []);
  return useMemo(() => ({
    ink: resolve('--color-ink'), ink2: resolve('--color-ink-2'), muted: resolve('--color-muted'), rule: resolve('--color-rule'), rule2: resolve('--color-rule-2'), cool: resolve('--color-cool'), accent: resolve('--color-accent'), ok: resolve('--color-ok'), bad: resolve('--color-bad'), paper2: resolve('--color-paper-2'),
    font: getComputedStyle(document.body).fontFamily, mono: getComputedStyle(document.documentElement).getPropertyValue('--font-outlier'),
  }), [theme]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function EChart({ option, height = 280, label, onClick }: { option: EChartsCoreOption; height?: number; label: string; onClick?: (name: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts>();
  const click = useRef(onClick); click.current = onClick;
  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: 'svg' });
    chart.current = c;
    c.on('click', (p: { name?: string }) => { if (p.name) click.current?.(p.name); });
    const ro = new ResizeObserver(() => c.resize()); ro.observe(el.current!);
    return () => { ro.disconnect(); c.dispose(); };
  }, []);
  useEffect(() => { chart.current?.setOption(option, { notMerge: true }); }, [option]);
  return <div ref={el} role="img" aria-label={label} style={{ height, width: '100%' }} />;
}

export const baseOption = (p: Palette): EChartsCoreOption => ({
  textStyle: { fontFamily: p.font, color: p.muted }, animationDuration: 300, animationEasing: 'cubicOut',
  grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: p.paper2, borderColor: p.rule2, textStyle: { color: p.ink, fontFamily: p.font, fontSize: 13 }, extraCssText: 'box-shadow:none;' },
  aria: { enabled: true },
});
