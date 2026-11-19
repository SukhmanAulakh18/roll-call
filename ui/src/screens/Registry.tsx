import { useMemo, useState } from 'react';
import { ArrowDownUp, Search } from 'lucide-react';
import type { AgentRecord } from '../../../contracts/types';
import { useStore } from '../store';
import { Initials, StateIcon, StateMark, ownerShort, type AgentState } from '../ui';

type Key = 'name' | 'team' | 'risk' | 'life' | 'eval';
const RISK = ['critical', 'high', 'medium', 'low'];
const val = (a: AgentRecord, k: Key) => (k === 'name' ? a.name : k === 'team' ? a.owner.team : k === 'risk' ? RISK.indexOf(a.riskRating) : k === 'life' ? a.lifecycleState : a.evaluation ? (a.evaluation.passed ? 2 : 1) : 0);

export function Registry() {
  const agents = useStore((s) => s.agents);
  const states = useStore((s) => s.fleet?.states);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: 'risk', dir: 1 });
  const rows = useMemo(() => {
    const t = q.toLowerCase();
    return agents.filter((a) => !t || `${a.name} ${a.id} ${a.owner.name} ${a.owner.team} ${a.lifecycleState} ${a.riskRating}`.toLowerCase().includes(t))
      .sort((a, b) => { const x = val(a, sort.k), y = val(b, sort.k); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [agents, q, sort]);
  const Th = ({ k, children, className = '' }: { k: Key; children: string; className?: string }) => (
    <th className={className} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="thbtn" onClick={() => setSort({ k, dir: sort.k === k ? (sort.dir === 1 ? -1 : 1) : 1 })}>{children}<ArrowDownUp size={12} aria-hidden /></button>
    </th>
  );
  return (
    <div className="registry">
      <header className="page-h"><div><h1>Registry</h1><p className="lead">Every agent on record: who owns it, what it may touch, and whether it passed evaluation. Open one to see it on the map.</p></div></header>
      <section className="panel" aria-label="Registered agents">
        <div className="panel-h"><label className="search"><Search size={14} aria-hidden /><span className="visually-hidden">Search the registry</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, owner, team, risk" /></label><span className="muted measured">{rows.length} of {agents.length}</span></div>
        {agents.length ? (
          <div className="tablewrap"><table className="reg"><thead><tr><Th k="name">Agent</Th><Th k="team">Owner</Th><Th k="risk">Risk</Th><Th k="life">Lifecycle</Th><Th k="eval">Evaluation</Th><th>State</th><th>Tools</th></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.id}>
                <td><a href={`#/agent/${a.id}`} className="strong">{a.name}</a><br /><span className="measured muted">{a.id}</span></td>
                <td><span className="owner"><Initials name={a.owner.name} size={26} />{ownerShort(a.owner.name)}</span><br /><span className="muted">{a.owner.team}</span></td>
                <td>{a.riskRating}</td><td>{a.lifecycleState}</td>
                <td>{a.evaluation ? <span className={`evalmark ${a.evaluation.passed ? 'is-ok' : 'is-bad'}`}><StateIcon state={a.evaluation.passed ? 'healthy' : 'alert'} />{a.evaluation.passed ? 'Passed' : 'Failed'}</span> : <span className="evalmark is-bad"><StateIcon state="alert" />None on record</span>}</td>
                <td>{states?.[a.id] ? <StateMark state={states[a.id] as AgentState} /> : <span className="muted">no data</span>}</td>
                <td className="measured">{a.scopes.tools.length}</td>
              </tr>))}</tbody></table></div>
        ) : <p className="empty">No records loaded. Start the stack with <code className="measured">make stack</code>, or add <code className="measured">?fixture=1</code> to the address.</p>}
      </section>
    </div>
  );
}
