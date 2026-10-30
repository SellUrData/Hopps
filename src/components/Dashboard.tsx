import { useMemo, useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cmToUnits, formatHeight } from '../lib/physics';
import { dailyBest, distribution, sessionSummaries, summarize } from '../lib/stats';
import { JUMP_TYPES, type JumpRecord, type JumpType, type Settings } from '../lib/storage';
import Icon from './Icon';

interface Props {
  jumps: JumpRecord[];
  settings: Settings;
  onMeasure: () => void;
  onLoadDemo: () => void;
}

const tooltipStyle = {
  contentStyle: { background: '#141a26', border: '1px solid #263045', borderRadius: 10, color: '#e8edf5' },
  labelStyle: { color: '#8b97ad' },
};

export default function Dashboard({ jumps, settings, onMeasure, onLoadDemo }: Props) {
  const [filter, setFilter] = useState<JumpType | 'All'>('All');
  const u = settings.units;
  const fmt = (cm: number | null | undefined) => (cm == null ? '—' : formatHeight(cm, u));

  const filtered = useMemo(() => (filter === 'All' ? jumps : jumps.filter((j) => j.type === filter)), [jumps, filter]);
  const s = useMemo(() => summarize(filtered), [filtered]);
  const sessions = useMemo(() => {
    const conv = (cm: number) => Number(cmToUnits(cm, u).toFixed(1));
    return sessionSummaries(filtered).map((x) => ({
        label: new Date(x.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        best: conv(x.best),
        avg: conv(x.avg),
      }));
  }, [filtered, u]);
  const daily = useMemo(
    () => dailyBest(filtered, 14).map((d) => ({ ...d, best: d.best == null ? 0 : Number(cmToUnits(d.best, u).toFixed(1)) })),
    [filtered, u],
  );
  const dist = useMemo(
    () => distribution(filtered, u === 'in' ? 2.54 * 2 : 5).map((b) => ({ label: `${Math.round(cmToUnits(b.from, u))}`, count: b.count })),
    [filtered, u],
  );
  const recent = useMemo(() => [...filtered].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5), [filtered]);

  const [dayPart] = useState(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  });
  const greeting = settings.name ? `${dayPart}, ${settings.name}` : dayPart;

  if (!jumps.length) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <p className="muted">{greeting}</p>
            <h1>VertiJump</h1>
          </div>
        </header>
        <section className="card empty">
          <div className="empty-icon"><Icon name="bolt" size={36} /></div>
          <h2>Measure your first jump</h2>
          <p className="muted">Point your phone camera at yourself, jump, and VertiJump calculates your vertical from your flight time.</p>
          <button className="btn primary" onClick={onMeasure}><Icon name="camera" /> Start measuring</button>
          <button className="btn ghost" onClick={onLoadDemo}>Load demo data</button>
        </section>
      </div>
    );
  }

  const improvement = s.firstSessionBest != null && s.lastSessionBest != null && s.sessions > 1 ? s.lastSessionBest - s.firstSessionBest : null;
  const goal = settings.goalCm;
  const goalPct = goal && s.best ? Math.min(100, (s.best.heightCm / goal) * 100) : null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="muted">{greeting}</p>
          <h1>Dashboard</h1>
        </div>
        <button className="btn primary sm" onClick={onMeasure}><Icon name="camera" size={18} /> Jump</button>
      </header>

      <div className="chips">
        {(['All', ...JUMP_TYPES] as const).map((t) => (
          <button key={t} className={`chip ${filter === t ? 'on' : ''}`} onClick={() => setFilter(t)}>{t}</button>
        ))}
      </div>

      {!filtered.length ? (
        <section className="card"><p className="muted">No {filter.toLowerCase()} jumps yet.</p></section>
      ) : (
        <>
          <section className="card hero">
            <div className="hero-label"><Icon name="trophy" size={18} /> Personal best</div>
            <div className="hero-value">{fmt(s.best?.heightCm)}</div>
            <div className="muted">
              {s.best && `${new Date(s.best.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${s.best.type} · ${Math.round(s.best.flightTimeMs)} ms flight`}
            </div>
            {goalPct != null && (
              <div className="goal">
                <div className="goal-bar"><div style={{ width: `${goalPct}%` }} /></div>
                <span className="muted">{goalPct.toFixed(0)}% of {fmt(goal)} goal</span>
              </div>
            )}
          </section>

          <div className="stat-grid">
            <div className="stat"><span className="label">Avg (last 10)</span><span className="value">{fmt(s.avgRecent)}</span></div>
            <div className="stat"><span className="label">Best · 7 days</span><span className="value">{fmt(s.best7d)}</span></div>
            <div className="stat">
              <span className="label">Progress</span>
              <span className={`value ${improvement != null && improvement > 0 ? 'up' : improvement != null && improvement < 0 ? 'down' : ''}`}>
                {improvement == null ? '—' : `${improvement >= 0 ? '+' : '−'}${formatHeight(Math.abs(improvement), u)}`}
              </span>
              <span className="hint">first → latest session</span>
            </div>
            <div className="stat">
              <span className="label">Consistency</span>
              <span className="value">{s.consistency == null ? '—' : `${Math.round(s.consistency)}%`}</span>
              <span className="hint">last 10 jumps</span>
            </div>
            <div className="stat"><span className="label">Total jumps</span><span className="value">{s.total}</span></div>
            <div className="stat"><span className="label">Sessions</span><span className="value">{s.sessions}</span></div>
          </div>

          <section className="card">
            <div className="card-head"><h2>Progress by session</h2><span className="muted">{u}</span></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={sessions} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="bestFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c6ff3d" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#c6ff3d" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1f2738" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#8b97ad', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tick={{ fill: '#8b97ad', fontSize: 11 }} tickLine={false} axisLine={false} domain={['dataMin - 3', 'dataMax + 2']} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} formatter={(v, name) => [`${v} ${u}`, name === 'best' ? 'Best' : 'Average']} />
                  <Area type="monotone" dataKey="best" stroke="#c6ff3d" strokeWidth={2.5} fill="url(#bestFill)" dot={{ r: 3, fill: '#c6ff3d' }} />
                  <Line type="monotone" dataKey="avg" stroke="#38bdf8" strokeWidth={2} dot={false} strokeDasharray="5 4" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="legend"><span className="dot lime" /> Best <span className="dot sky" /> Average</div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Last 14 days</h2><span className="muted">daily best</span></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#1f2738" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: '#8b97ad', fontSize: 10 }} tickLine={false} axisLine={false} interval={1} />
                  <YAxis tick={{ fill: '#8b97ad', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v) => (Number(v) ? `${v} ${u}` : 'Rest day')} />
                  <Bar dataKey="best" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Jump distribution</h2><span className="muted">{u}</span></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={dist} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fill: '#8b97ad', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#8b97ad', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v) => [`${v} jumps`, 'Count']} labelFormatter={(l) => `${l}+ ${u}`} />
                  <Bar dataKey="count" fill="#a78bfa" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Recent jumps</h2></div>
            <ul className="jump-list">
              {recent.map((j) => (
                <li key={j.id}>
                  <span className="h">{fmt(j.heightCm)}</span>
                  <span className="muted grow">{j.type}</span>
                  <span className="muted">{new Date(j.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
