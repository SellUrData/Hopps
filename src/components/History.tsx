import { useMemo } from 'react';
import { formatHeight } from '../lib/physics';
import { sessionSummaries } from '../lib/stats';
import type { JumpRecord, Settings } from '../lib/storage';
import Icon from './Icon';

interface Props {
  jumps: JumpRecord[];
  settings: Settings;
  onDelete: (id: string) => void;
}

export default function History({ jumps, settings, onDelete }: Props) {
  const groups = useMemo(() => {
    const bySession = new Map<string, JumpRecord[]>();
    for (const j of jumps) {
      const arr = bySession.get(j.sessionId) ?? [];
      arr.push(j);
      bySession.set(j.sessionId, arr);
    }
    return sessionSummaries(jumps)
      .reverse()
      .map((s) => ({ ...s, jumps: (bySession.get(s.sessionId) ?? []).sort((a, b) => a.timestamp - b.timestamp) }));
  }, [jumps]);
  const allBest = jumps.reduce((b, j) => Math.max(b, j.heightCm), 0);
  const fmt = (cm: number) => formatHeight(cm, settings.units);

  return (
    <div className="page">
      <header className="page-head"><h1>History</h1></header>
      {!groups.length && <section className="card"><p className="muted">No jumps recorded yet.</p></section>}
      {groups.map((g) => (
        <section className="card" key={g.sessionId}>
          <div className="card-head">
            <h2>{new Date(g.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</h2>
            <span className="muted">{new Date(g.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
          </div>
          <div className="session-stats">
            <span><b>{fmt(g.best)}</b> best</span>
            <span><b>{fmt(g.avg)}</b> avg</span>
            <span><b>{g.count}</b> jumps</span>
          </div>
          <ul className="jump-list">
            {g.jumps.map((j) => (
              <li key={j.id}>
                <span className="h">
                  {fmt(j.heightCm)}
                  {j.heightCm === allBest && <span className="pb">PB</span>}
                </span>
                <span className="muted grow">{j.type}</span>
                <span className="muted">{Math.round(j.flightTimeMs)} ms</span>
                <button className="btn icon ghost" aria-label="Delete jump" onClick={() => onDelete(j.id)}><Icon name="trash" size={18} /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
