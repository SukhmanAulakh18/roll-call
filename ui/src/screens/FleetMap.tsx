import { memo, useMemo } from 'react';
import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { useStore } from '../store';
import { StateIcon, stateLabel, usd, type AgentState } from '../ui';

type AgentData = { id: string; name: string; state: AgentState; d: number; rate?: number };
const AgentNode = memo(({ data }: NodeProps) => {
  const a = data as unknown as AgentData;
  const hot = a.state === 'alert' || a.state === 'throttled';
  const border = a.state === 'killed' ? 'border-dashed' : a.state === 'throttled' ? 'border-double !border-[6px]' : a.state === 'alert' ? 'border-solid !border-[4px]' : 'border-solid';
  return (
    <div className="flex w-[150px] flex-col items-center text-center">
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <a href={`#/agent/${encodeURIComponent(a.id)}`} aria-label={`${a.name}. ${stateLabel(a.state)}. ${a.rate != null ? usd(a.rate, 3) + ' per minute.' : ''} Open agent card`}
        className={`flex flex-col items-center justify-center rounded-full border-2 bg-surface no-underline ${border} ${hot ? 'border-accent text-accent' : a.state === 'killed' ? 'border-mute text-mute' : 'border-ink text-ink'} ${a.state === 'alert' ? 'pulse' : ''}`}
        style={{ width: a.d, height: a.d }}>
        <StateIcon state={a.state} size={Math.round(a.d / 2.6)} />
      </a>
      <span className="mt-2 text-[0.9rem] font-semibold leading-tight text-ink">{a.name}</span>
      <span className={`text-[0.8rem] ${hot ? 'text-accent font-semibold' : 'text-mute'}`}>{stateLabel(a.state)}{a.rate != null && ` · ${usd(a.rate, 2)}/min`}</span>
    </div>
  );
});
const ToolNode = memo(({ data }: NodeProps) => {
  const t = data as unknown as { label: string; kind: string };
  return (
    <div className={`rounded-md border border-line bg-raised px-3 py-1.5 text-[0.82rem] ${t.kind === 'data' ? 'border-dashed' : ''}`}>
      <span className="text-mute">{t.kind === 'data' ? 'data ' : 'tool '}</span><span className="font-mono">{t.label}</span>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
});
const nodeTypes = { agent: AgentNode, tool: ToolNode };

export function FleetMap() {
  const agents = useStore((s) => s.agents);
  const fleet = useStore((s) => s.fleet);
  const { nodes, edges } = useMemo(() => {
    const rates = fleet?.spendPerMinUsd ?? {};
    const max = Math.max(0, ...Object.values(rates));
    const tools = [...new Set(agents.flatMap((a) => (a.scopes?.tools ?? []).map((t) => 'tool:' + t)))].sort();
    const data = [...new Set(agents.flatMap((a) => (a.scopes?.data ?? []).map((t) => 'data:' + t)))].sort();
    const ends = [...tools, ...data];
    const per = 6, gap = 200, width = per * gap;
    const nodes: Node[] = ends.map((k, i) => ({ id: k, type: 'tool', position: { x: ((Math.floor(i / 3) + 0.5) * width) / Math.ceil(ends.length / 3) - 70, y: (i % 3) * 44 }, data: { label: k.split(':')[1], kind: k.split(':')[0] }, draggable: false }));
    agents.forEach((a, i) => {
      const r = rates[a.id];
      nodes.push({ id: a.id, type: 'agent', position: { x: (i % per) * gap, y: 230 + Math.floor(i / per) * 200 }, draggable: false,
        data: { id: a.id, name: a.name, state: (fleet?.states?.[a.id] ?? 'unknown') as AgentState, rate: r, d: 56 + (max > 0 && r ? Math.round(44 * Math.sqrt(r / max)) : 0) } });
    });
    const edges: Edge[] = agents.flatMap((a) => [...(a.scopes?.tools ?? []).map((t) => 'tool:' + t), ...(a.scopes?.data ?? []).map((t) => 'data:' + t)].map((k) => ({ id: `${a.id}>${k}`, source: k, target: a.id })));
    return { nodes, edges };
  }, [agents, fleet]);

  if (!agents.length) return <p className="panel text-mute">No agents loaded yet. Start the stack with <code className="font-mono text-ink">make stack</code>.</p>;
  return (
    <figure>
      <div className="h-[680px] rounded-lg border border-line bg-surface" role="group" aria-label="Fleet map. Each agent is a link to its card.">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.08 }} nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable={false} zoomOnScroll={false} panOnDrag={false} zoomOnDoubleClick={false} preventScrolling={false} proOptions={{ hideAttribution: true }}>
          <Background color="var(--line)" gap={28} />
        </ReactFlow>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.9rem] text-mute">
        {(['healthy', 'alert', 'throttled', 'killed'] as AgentState[]).map((s) => <span key={s} className="inline-flex items-center gap-1.5"><StateIcon state={s} size={18} />{stateLabel(s)}</span>)}
        <span>Circle size = spend per minute · lines = what each agent may touch · dashed box = data</span>
      </figcaption>
    </figure>
  );
}
