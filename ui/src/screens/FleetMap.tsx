import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BaseEdge, Background, BackgroundVariant, Controls, EdgeLabelRenderer, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, getBezierPath, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import { useReducedMotion } from 'motion/react';
import { Database, Search, Wrench, Rows3, ShieldAlert, Maximize2, Expand, Shrink } from 'lucide-react';
import { AgentDrawer, EdgeDrawer, ToolDrawer } from '../drawer';
import { toolWhat } from '../vocab';
import type { ActionEvent, AgentRecord } from '../../../contracts/types';
import { getState, useStore } from '../store';
import { closeDrawer, openAgent, useUi } from '../ui-state';
import { Initials, Sparkline, StateIcon, Tip, stateLabel, usd, useLocal, useNow, type AgentState } from '../ui';
import { AGENT_H, AGENT_W, NODE_H, TOOL_W, computeStats, groupKey, layout, liveIncident, type GroupBy, type LiveStats } from '../graph';

type Sel = { k: 'agent' | 'tool' | 'data'; id: string } | { k: 'edge'; id: string; agent: string; target: string; tk: 'tool' | 'data' };
interface MapCtx { pick: (k: 'agent' | 'tool' | 'data', id: string) => void; sel: Sel | null; rel: Set<string> | null; selected: string | null; hover: string | null; setHover: (id: string | null) => void; dim: Set<string>; by: GroupBy; reduce: boolean }
const Ctx = createContext<MapCtx>({ pick: () => undefined, sel: null, rel: null, selected: null, hover: null, setHover: () => undefined, dim: new Set(), by: 'team', reduce: false });

// ---------------- nodes ----------------
const StateRing = ({ state }: { state: AgentState }) => (
  <span className={`ring s-${state}`} aria-hidden="true"><svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="18" /></svg><StateIcon state={state} size={18} /></span>
);

const AgentNode = memo(function AgentNode({ data }: NodeProps<Node<{ agent: AgentRecord; side: 'l' | 'r' }>>) {
  const { agent: a, side } = data;
  const c = useContext(Ctx);
  const state = (useStore((s) => s.fleet?.states?.[a.id]) ?? 'unknown') as AgentState;
  const rate = useStore((s) => s.fleet?.spendPerMinUsd?.[a.id]);
  const hist = useStore((s) => s.spendHist[a.id]) ?? [];
  const group = groupKey(a, c.by);
  const dim = c.dim.has(a.id) || (!!c.rel && !c.rel.has(`a:${a.id}`));
  return (
    <div className={`anode s-${state} ${c.selected === a.id ? 'is-selected' : ''} ${dim ? 'is-dim' : ''}`} style={{ width: AGENT_W, height: AGENT_H }}>
      <Handle id="l" type="source" position={Position.Left} isConnectable={false} />
      <Handle id="r" type="source" position={Position.Right} isConnectable={false} />
      <Handle id="lt" type="target" position={Position.Left} isConnectable={false} style={{ top: '70%' }} />
      <Handle id="rt" type="target" position={Position.Right} isConnectable={false} style={{ top: '70%' }} />
      <Tip side={side === 'l' ? 'left' : 'right'} label={<div className="scope-tip"><strong>{a.name}</strong><span className="muted">may call</span><span className="measured">{a.scopes.tools.join('  ')}</span><span className="muted">may read</span><span className="measured">{a.scopes.data.join('  ')}</span></div>}>
        <button type="button" className="anode-btn nodrag" onClick={() => c.pick('agent', a.id)} onMouseEnter={() => c.setHover(a.id)} onMouseLeave={() => c.setHover(null)} onFocus={() => c.setHover(a.id)} onBlur={() => c.setHover(null)} aria-pressed={c.selected === a.id}>
          <StateRing state={state} />
          <span className="anode-main">
            <span className="anode-name">{a.name}</span>
            <span className="anode-group">{group}</span>
            <span className="anode-meta">
              <Sparkline values={hist} w={110} h={28} tone={state === 'killed' ? 'muted' : state === 'healthy' ? 'cool' : 'warn'} label={`${a.name} spend per minute trend`} />
              <span className="measured">{typeof rate === 'number' ? `${usd(rate, 3)}/min` : 'no rate yet'}</span>
            </span>
          </span>
          <Initials name={a.owner.name} size={28} />
          <span className="visually-hidden">, {stateLabel(state)}. Open details.</span>
        </button>
      </Tip>
      <span className="anode-state">{stateLabel(state)}</span>
    </div>
  );
});

const ToolNode = memo(function ToolNode({ data }: NodeProps<Node<{ name: string; kind: 'tool' | 'data'; hot: boolean; drift: boolean; dim: boolean }>>) {
  const c = useContext(Ctx);
  const label = data.kind === 'data' ? data.name.replace(/^synthetic-/, '') : data.name;
  const key = `${data.kind === 'data' ? 'd' : 't'}:${data.name}`;
  const dim = !!c.rel && !c.rel.has(key);
  const on = c.sel?.k === data.kind && c.sel.id === data.name;
  return (
    <div className={`tnode k-${data.kind} ${data.hot ? 'is-hot' : ''} ${data.drift ? 'is-drift' : ''} ${dim ? 'is-dim' : ''} ${on ? 'is-selected' : ''}`} style={{ width: TOOL_W, height: NODE_H }}>
      <Handle id="tl" type="target" position={Position.Left} isConnectable={false} /><Handle id="tr" type="target" position={Position.Right} isConnectable={false} />
      <Tip side="top" label={<div className="scope-tip"><strong>{label}</strong><span>{data.kind === 'tool' ? toolWhat(data.name) : 'Data source. Click for who may read it.'}</span></div>}>
        <button type="button" className="tnode-btn nodrag" aria-pressed={on} onClick={() => c.pick(data.kind, data.name)}>
          {data.kind === 'data' ? <Database size={15} aria-hidden /> : <Wrench size={15} aria-hidden />}<span className="measured">{label}</span>
          {data.drift && <ShieldAlert size={15} aria-label="out-of-scope call seen" />}
          <span className="visually-hidden">, {data.kind === 'tool' ? 'tool' : 'data source'}. Open details.</span>
        </button>
      </Tip>
    </div>
  );
});

// ---------------- edges ----------------
type EKind = 'tool' | 'data' | 'drift' | 'cycle' | 'a2a';
interface EData { kind: EKind; rate: number; dim: boolean; hot: boolean; rel?: boolean; sel?: boolean; pulses?: { id: string; v: ActionEvent['verdict'] }[]; label?: string; [k: string]: unknown }
const FlowEdge = memo(function FlowEdge(p: EdgeProps<Edge<EData>>) {
  const d = p.data!;
  const reduce = useContext(Ctx).reduce;
  const [path, lx, ly] = getBezierPath({ sourceX: p.sourceX, sourceY: p.sourceY, targetX: p.targetX, targetY: p.targetY, sourcePosition: p.sourcePosition, targetPosition: p.targetPosition, curvature: d.kind === 'cycle' ? 0.6 : 0.25 });
  const n = d.kind === 'tool' || d.kind === 'a2a' ? Math.min(6, Math.round(d.rate * 1.4)) : 0;
  const dur = Math.max(0.9, 3.2 / (1 + d.rate));
  const width = d.kind === 'cycle' ? 2.6 : d.kind === 'drift' ? 2 : d.hot ? 1.4 + Math.min(2.2, d.rate * 0.5) : 1;
  return (
    <g className={`edge e-${d.kind} ${d.hot ? 'is-hot' : ''} ${d.dim ? 'is-dim' : ''} ${d.rel ? 'is-rel' : ''} ${d.sel ? 'is-sel' : ''}`}>
      <BaseEdge id={p.id} path={path} style={{ strokeWidth: width }} interactionWidth={22} />
      {!reduce && d.pulses?.map((x) => <Pulse key={x.id} path={path} v={x.v} />)}
      {!reduce && n > 0 && Array.from({ length: n }, (_, i) => (
        <circle key={i} r={2.6} className="particle"><animateMotion dur={`${dur}s`} begin={`${-(i * dur) / n}s`} repeatCount="indefinite" path={path} /></circle>
      ))}
      {d.label && (
        <EdgeLabelRenderer><div className={`elabel e-${d.kind}`} style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)` }}>{d.kind === 'drift' ? <ShieldAlert size={12} aria-hidden /> : null}{d.label}</div></EdgeLabelRenderer>
      )}
    </g>
  );
});

function Pulse({ path, v }: { path: string; v: ActionEvent['verdict'] }) {
  const a = useRef<SVGAnimateMotionElement>(null), b = useRef<SVGAnimateElement>(null);
  useEffect(() => { try { a.current?.beginElement(); b.current?.beginElement(); } catch { /* not supported */ } }, []);
  return (
    <circle r={4.5} className={`pulse pulse-${v}`} opacity="0">
      <animateMotion ref={a} dur="1.2s" begin="indefinite" repeatCount="1" fill="freeze" path={path} />
      <animate ref={b} attributeName="opacity" values="1;1;0" keyTimes="0;0.75;1" dur="1.2s" begin="indefinite" fill="freeze" />
    </circle>
  );
}

const nodeTypes = { agent: AgentNode, tool: ToolNode };
const edgeTypes = { flow: FlowEdge };

// ---------------- the map ----------------
function Inner({ selected, onSelect, focus, compact }: { selected: string | null; onSelect: (id: string | null) => void; focus?: string; compact?: boolean }) {
  const allAgents = useStore((s) => s.agents);
  const incidents = useStore((s) => s.incidents);
  const newestTs = useStore((s) => s.actions[s.actions.length - 1]?.ts ?? 0);
  const states = useStore((s) => s.fleet?.states);
  const reduce = !!useReducedMotion();
  const now = useNow(1000);
  const rf = useReactFlow();
  const [by, setBy] = useLocal<GroupBy>('groupBy', 'team');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | AgentState>('all');
  const [hover, setHover] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const gdrawer = useUi((u) => u.drawer);
  useEffect(() => { if (gdrawer) setSel(null); }, [gdrawer]);
  const canKill = useStore((s) => s.source === 'live' || s.source === 'fixture');
  const dialogOpen = useUi((u) => !!u.killId);
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);   // true in native fullscreen or in the modal fallback
  const [modal, setModal] = useState(false);
  const refit = useCallback(() => setTimeout(() => rf.fitView({ padding: 0.04, duration: 0 }), 150), [rf]);
  // Full screen is a fixed overlay (not the browser API) so the receipt and kill dialogs, which portal to the page, stay visible on top of it.
  const toggleFull = () => { setModal(!modal); setFull(!modal); refit(); };
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || dialogOpen || !root.current?.contains(document.activeElement) && !modal) return;
      if (sel) { setSel(null); (document.activeElement as HTMLElement | null)?.blur?.(); }
      else if (modal) { setModal(false); setFull(false); refit(); }
    };
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, [modal, refit, sel, dialogOpen]);

  const agents = useMemo(() => {
    if (!focus) return allAgents;
    const f = allAgents.find((a) => a.id === focus);
    return f ? [f] : [];
  }, [allAgents, focus]);
  const stats: LiveStats = useMemo(() => computeStats(getState().actions, allAgents, now), [now, allAgents]);  
  const inc = liveIncident(incidents, newestTs);
  const cycle = inc?.last.signals?.cycle ?? inc?.byStage.detected?.signals?.cycle;
  const driftTool = inc?.byStage.detected?.signals?.scopeDrift;

  const lay = useMemo(() => {
    const extra = [...stats.drift.keys()].map((k) => k.split('>')[1]);
    if (focus) {
      const a = agents[0];
      const tools = a ? [...new Set([...a.scopes.tools, ...extra.filter((_, i) => [...stats.drift.keys()][i].startsWith(focus + '>'))])].sort() : [];
      return { agents: a ? [{ id: a.id, x: 0, y: Math.max(0, (tools.length * 30 - AGENT_H) / 2), side: 'l' as const, group: '' }] : [], tools: tools.map((id, i) => ({ id, x: 360, y: i * 30 })), data: [] };
    }
    return layout(agents, by, extra);
  }, [agents, by, focus, stats.drift]);

  const match = (a: AgentRecord) => (!q || `${a.name} ${a.id} ${a.owner.team} ${a.owner.name} ${a.scopes.tools.join(' ')}`.toLowerCase().includes(q.toLowerCase())) && (filter === 'all' || (states?.[a.id] ?? 'unknown') === filter);
  const dim = useMemo(() => new Set(agents.filter((a) => !match(a)).map((a) => a.id)), [agents, q, filter, states]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusId = hover ?? (sel?.k === 'agent' ? sel.id : null) ?? selected;
  const rel = useMemo<Set<string> | null>(() => {
    const r = new Set<string>();
    const scoped = (a: AgentRecord) => { r.add(`a:${a.id}`); a.scopes.tools.forEach((t) => r.add(`t:${t}`)); a.scopes.data.forEach((d) => r.add(`d:${d}`)); for (const k of stats.drift.keys()) { const [x, t] = k.split('>'); if (x === a.id) r.add(`t:${t}`); } };
    if (sel?.k === 'edge') { r.add(`a:${sel.agent}`); r.add(`${sel.tk === 'tool' ? 't' : 'd'}:${sel.target}`); return r; }
    if (sel?.k === 'tool' || sel?.k === 'data') {
      const p = sel.k === 'tool' ? 't' : 'd'; r.add(`${p}:${sel.id}`);
      for (const a of agents) if ((sel.k === 'tool' ? a.scopes.tools : a.scopes.data).includes(sel.id) || (sel.k === 'tool' && stats.drift.has(`${a.id}>${sel.id}`))) r.add(`a:${a.id}`);
      return r;
    }
    const fa = focusId && !focus ? agents.find((a) => a.id === focusId) : undefined;
    if (!fa) return null;
    scoped(fa);
    for (const k of stats.a2a.keys()) { const [x, y] = k.split('>'); if (x === fa.id) r.add(`a:${y}`); if (y === fa.id) r.add(`a:${x}`); }
    return r;
  }, [sel, focusId, focus, agents, stats]);
  const recent = useMemo(() => {
    const m = new Map<string, { id: string; v: ActionEvent['verdict'] }[]>();
    if (!sel && !hover) return m;
    const acts = getState().actions, ref = Math.abs(newestTs - now) > 60_000 ? newestTs : now;
    for (let i = acts.length - 1; i >= 0 && i > acts.length - 80; i--) {
      const c = acts[i]; if (!c.governed) continue;
      if (ref - c.ts > 3500) break;
      const ag = agents.find((x) => x.id === c.agentId);
      const k = `${ag?.scopes.tools.includes(c.tool) ? 'e' : 'drift'}:${c.agentId}>${c.tool}`;
      m.set(k, [...(m.get(k) ?? []), { id: c.receiptId, v: c.verdict }]);
    }
    return m;
  }, [sel, hover, agents, newestTs, now]);

  const nodes: Node[] = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const out: Node[] = [];
    for (const l of lay.agents) out.push({ id: `a:${l.id}`, type: 'agent', position: { x: l.x, y: l.y }, data: { agent: byId.get(l.id)!, side: l.side }, draggable: false, selectable: false, focusable: false, width: AGENT_W, height: AGENT_H });
    const driftTools = new Set([...stats.drift.keys()].map((k) => k.split('>')[1]));
    for (const t of lay.tools) {
      const hot = [...stats.rate.keys()].some((k) => k.endsWith('>' + t.id));
      out.push({ id: `t:${t.id}`, type: 'tool', position: { x: t.x, y: t.y }, data: { name: t.id, kind: 'tool', hot, drift: driftTools.has(t.id), dim: false }, draggable: false, selectable: false, focusable: false, width: TOOL_W, height: NODE_H });
    }
    for (const t of lay.data) out.push({ id: `d:${t.id}`, type: 'tool', position: { x: t.x, y: t.y }, data: { name: t.id, kind: 'data', hot: false, drift: false, dim: false }, draggable: false, selectable: false, focusable: false, width: TOOL_W, height: NODE_H });
    return out;
  }, [lay, agents, stats]);

  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = [];
    const side = new Map(lay.agents.map((l) => [l.id, l.side]));
    const edgeRel = (x: string, y: string) => !rel || (rel.has(x) && rel.has(y));
    const selEdge = (id: string) => sel?.k === 'edge' && id === `e:${sel.agent}${sel.tk === 'tool' ? '>' : '~'}${sel.target}`;
    const mk = (id: string, x: string, y: string, d: EData): EData => ({ ...d, dim: d.dim || !edgeRel(x, y), rel: !!rel && edgeRel(x, y), sel: selEdge(id), pulses: recent.get(id) });
    for (const a of agents) {
      const s = side.get(a.id) ?? 'l';
      const sh = s === 'l' ? 'r' : 'l', th = s === 'l' ? 'tl' : 'tr';
      const dimmed = dim.has(a.id);
      for (const t of a.scopes.tools) {
        const r = stats.rate.get(`${a.id}>${t}`) ?? 0;
        out.push({ id: `e:${a.id}>${t}`, source: `a:${a.id}`, sourceHandle: sh, target: `t:${t}`, targetHandle: th, type: 'flow', data: mk(`e:${a.id}>${t}`, `a:${a.id}`, `t:${t}`, { kind: 'tool', rate: r, hot: r > 0, dim: dimmed }), selectable: false, focusable: false });
      }
      for (const dd of a.scopes.data) out.push({ id: `e:${a.id}~${dd}`, source: `a:${a.id}`, sourceHandle: sh, target: `d:${dd}`, targetHandle: th, type: 'flow', data: mk(`e:${a.id}~${dd}`, `a:${a.id}`, `d:${dd}`, { kind: 'data', rate: 0, hot: false, dim: dimmed }), selectable: false, focusable: false });
    }
    for (const [k, v] of stats.drift) {
      const [aid, tool] = k.split('>');
      if (!side.has(aid)) continue;
      const s = side.get(aid)!;
      const fresh = (newestTs || now) - v.last < 15_000;
      out.push({ id: `drift:${k}`, source: `a:${aid}`, sourceHandle: s === 'l' ? 'r' : 'l', target: `t:${tool}`, targetHandle: s === 'l' ? 'tl' : 'tr', type: 'flow', data: mk(`drift:${k}`, `a:${aid}`, `t:${tool}`, { kind: 'drift', rate: 0, hot: fresh, dim: false, label: `out of scope ×${v.count}` }), className: fresh ? 'fresh' : '', selectable: false, focusable: false });
    }
    if (!focus) {
      const pairs = new Set<string>();
      if (cycle) for (let i = 0; i < cycle.length - 1; i++) pairs.add(`${cycle[i]}>${cycle[i + 1]}`);
      for (const [k, v] of stats.a2a) {
        const [x, y] = k.split('>');
        if (!side.has(x) || !side.has(y) || pairs.has(k)) continue;
        const sx = side.get(x)!, sy = side.get(y)!;
        out.push({ id: `a2a:${k}`, source: `a:${x}`, sourceHandle: sx === 'l' ? 'l' : 'r', target: `a:${y}`, targetHandle: sy === 'l' ? 'lt' : 'rt', type: 'flow', data: { kind: 'a2a', rate: v.count / 20, hot: true, dim: !edgeRel(`a:${x}`, `a:${y}`) } satisfies EData, selectable: false, focusable: false });
      }
      for (const k of pairs) {
        const [x, y] = k.split('>');
        if (!side.has(x) || !side.has(y)) continue;
        const sx = side.get(x)!, sy = side.get(y)!;
        out.push({ id: `cycle:${k}`, source: `a:${x}`, sourceHandle: sx === 'l' ? 'l' : 'r', target: `a:${y}`, targetHandle: sy === 'l' ? 'lt' : 'rt', type: 'flow', data: { kind: 'cycle', rate: 2, hot: true, dim: false, label: 'loop' } satisfies EData, selectable: false, focusable: false });
      }
    }
    void driftTool;
    return out;
  }, [agents, lay, stats, rel, sel, recent, dim, cycle, focus, newestTs, now, driftTool]);

  const pick = useCallback((k: 'agent' | 'tool' | 'data', id: string) => { if (compact) { if (k === 'agent') onSelect(id); return; } if (k === 'agent') { setSel(null); openAgent(id, 'reset'); return; } closeDrawer(); setSel({ k, id }); }, [compact, onSelect]);
  const ctx: MapCtx = useMemo(() => ({ pick, sel, rel, selected: sel?.k === 'agent' ? sel.id : sel ? null : selected, hover, setHover, dim, by, reduce }), [pick, sel, rel, selected, hover, dim, by, reduce]);
  const onEdgeClick = useCallback((_: unknown, e: Edge) => {
    if (compact) return;
    const m = /^(?:e|drift):([^>~]+)([>~])(.+)$/.exec(e.id);
    if (m) setSel({ k: 'edge', id: e.id, agent: m[1], target: m[3], tk: m[2] === '~' ? 'data' : 'tool' });
  }, [compact]);
  useEffect(() => { const h = setTimeout(() => rf.fitView({ padding: 0.04, duration: reduce ? 0 : 400 }), 60); return () => clearTimeout(h); }, [by, lay.agents.length, lay.tools.length, focus, compact, rf, reduce]);

  const counts = useMemo(() => { const c: Record<string, number> = { all: allAgents.length }; for (const a of allAgents) { const s = states?.[a.id] ?? 'unknown'; c[s] = (c[s] ?? 0) + 1; } return c; }, [allAgents, states]);

  return (
    <Ctx.Provider value={ctx}>
      <div ref={root} className={`map-root ${modal ? 'map-root--modal' : ''}`} {...(modal ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Fleet map, full screen' } : {})}>
      {!compact && (
        <div className="map-bar" role="toolbar" aria-label="Fleet map controls">
          <label className="search"><Search size={14} aria-hidden /><span className="visually-hidden">Search agents, teams or tools</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents or tools" /></label>
          <div className="seg" role="group" aria-label="Group agents by">
            <span className="seg-l">By</span>
            {(['team', 'risk'] as const).map((g) => <button key={g} type="button" aria-pressed={by === g} onClick={() => setBy(g)}>{g === 'team' ? 'Team' : 'Risk'}</button>)}
          </div>
          <div className="seg" role="group" aria-label="Filter by state">
            {(['all', 'healthy', 'alert', 'throttled', 'killed'] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} disabled={f !== 'all' && !counts[f]}>{f === 'all' ? 'All' : f === 'alert' ? 'Alert' : f === 'throttled' ? 'Slowed' : f === 'killed' ? 'Stopped' : 'Healthy'}<span className="measured">{counts[f] ?? 0}</span></button>)}
          </div>
          <button type="button" className="btn btn--sm" onClick={() => rf.fitView({ padding: 0.04, duration: reduce ? 0 : 400 })}><Maximize2 size={14} aria-hidden />Fit view</button>
          <button type="button" className="btn btn--sm" aria-pressed={full} onClick={toggleFull}>{full ? <Shrink size={14} aria-hidden /> : <Expand size={14} aria-hidden />}{full ? 'Exit full screen' : 'Full screen'}</button>
        </div>
      )}
      <div className="map-canvas" aria-label="Fleet map. Agents on the outside, tools and data in the middle. Select any agent, tool, data source or line to see what is executing. Escape closes the panel." role="group">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.04 }} minZoom={0.35} maxZoom={1.8} nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} onPaneClick={() => { setSel(null); if (compact || selected) onSelect(null); }} onEdgeClick={onEdgeClick} zoomOnDoubleClick={false}>
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} className="rf-dots" />
          {!compact && <Controls showInteractive={false} position="bottom-left" aria-label="Map zoom controls" />}
          {!compact && <MiniMap pannable zoomable position="bottom-right" ariaLabel="Fleet minimap" nodeStrokeWidth={2} nodeColor={(n) => (n.type === 'agent' ? 'var(--color-rule-2)' : 'var(--color-rule)')} maskColor="var(--color-scrim)" />}
        </ReactFlow>
        {!compact && <div className="map-legend" aria-hidden="true"><span><i className="lg lg-flow" />recent calls</span><span><i className="lg lg-drift" />out of scope</span><span><i className="lg lg-cycle" />loop</span></div>}
        {agents.length === 0 && <p className="map-empty"><Rows3 size={16} aria-hidden /> Waiting for the registry to load.</p>}
      </div>
      {!compact && sel && (sel.k === 'agent' ? <AgentDrawer id={sel.id} canKill={canKill} onClose={() => setSel(null)} />
        : sel.k === 'edge' ? <EdgeDrawer agentId={sel.agent} target={sel.target} kind={sel.tk} onClose={() => setSel(null)} onPick={(k, id) => pick(k, id)} />
        : <ToolDrawer id={sel.id} kind={sel.k} onClose={() => setSel(null)} onPick={(id) => pick('agent', id)} />)}
      {!compact && <p className="visually-hidden" aria-live="polite">{inc ? `Incident on ${inc.agentId}: ${inc.last.stage}` : 'No incident'}</p>}
      </div>
    </Ctx.Provider>
  );
}

export function FleetMap(props: { selected: string | null; onSelect: (id: string | null) => void; focus?: string; compact?: boolean }) {
  return <ReactFlowProvider><Inner {...props} /></ReactFlowProvider>;
}
