import type { JumpRecord } from './storage';

export interface SessionSummary {
  sessionId: string;
  start: number;
  best: number;
  avg: number;
  count: number;
}

export interface Summary {
  total: number;
  sessions: number;
  best: JumpRecord | null;
  avgRecent: number | null;
  best7d: number | null;
  best30d: number | null;
  firstSessionBest: number | null;
  lastSessionBest: number | null;
  consistency: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

export function sessionSummaries(jumps: JumpRecord[]): SessionSummary[] {
  const map = new Map<string, JumpRecord[]>();
  for (const j of jumps) {
    const arr = map.get(j.sessionId);
    if (arr) arr.push(j);
    else map.set(j.sessionId, [j]);
  }
  return [...map.entries()]
    .map(([sessionId, js]) => ({
      sessionId,
      start: Math.min(...js.map((j) => j.timestamp)),
      best: Math.max(...js.map((j) => j.heightCm)),
      avg: mean(js.map((j) => j.heightCm)),
      count: js.length,
    }))
    .sort((a, b) => a.start - b.start);
}

export function summarize(jumps: JumpRecord[], now = Date.now()): Summary {
  const sorted = [...jumps].sort((a, b) => a.timestamp - b.timestamp);
  const sessions = sessionSummaries(sorted);
  const bestIn = (days: number) => {
    const xs = sorted.filter((j) => j.timestamp >= now - days * 86_400_000).map((j) => j.heightCm);
    return xs.length ? Math.max(...xs) : null;
  };
  const recent = sorted.slice(-10).map((j) => j.heightCm);
  let consistency: number | null = null;
  if (recent.length >= 3) {
    const m = mean(recent);
    const sd = Math.sqrt(mean(recent.map((x) => (x - m) ** 2)));
    consistency = Math.max(0, 100 - (sd / m) * 100 * 4);
  }
  return {
    total: sorted.length,
    sessions: sessions.length,
    best: sorted.reduce<JumpRecord | null>((b, j) => (!b || j.heightCm > b.heightCm ? j : b), null),
    avgRecent: recent.length ? mean(recent) : null,
    best7d: bestIn(7),
    best30d: bestIn(30),
    firstSessionBest: sessions[0]?.best ?? null,
    lastSessionBest: sessions[sessions.length - 1]?.best ?? null,
    consistency,
  };
}

export function dailyBest(jumps: JumpRecord[], days: number, now = Date.now()) {
  const out: { day: string; best: number | null; count: number }[] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d0 = start.getTime() - i * 86_400_000;
    const d1 = d0 + 86_400_000;
    const js = jumps.filter((j) => j.timestamp >= d0 && j.timestamp < d1);
    out.push({
      day: new Date(d0).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      best: js.length ? Math.max(...js.map((j) => j.heightCm)) : null,
      count: js.length,
    });
  }
  return out;
}

export function distribution(jumps: JumpRecord[], binCm: number) {
  if (!jumps.length) return [];
  const hs = jumps.map((j) => j.heightCm);
  const lo = Math.floor(Math.min(...hs) / binCm) * binCm;
  const hi = Math.floor(Math.max(...hs) / binCm) * binCm;
  const bins: { from: number; count: number }[] = [];
  for (let b = lo; b <= hi; b += binCm) bins.push({ from: b, count: 0 });
  for (const h of hs) bins[Math.floor((h - lo) / binCm)].count++;
  return bins;
}
