import type { Units } from './physics';

export const JUMP_TYPES = ['Countermovement', 'Squat', 'Approach', 'Single-leg'] as const;
export type JumpType = (typeof JUMP_TYPES)[number];

export interface JumpRecord {
  id: string;
  timestamp: number;
  heightCm: number;
  flightTimeMs: number;
  type: JumpType;
  sessionId: string;
  source: 'live' | 'video' | 'demo';
  fps?: number;
  method?: 'fit' | 'crossing';
}

export interface Settings {
  units: Units;
  defaultType: JumpType;
  name: string;
  goalCm: number | null;
}

export interface AppData {
  version: 1;
  jumps: JumpRecord[];
  settings: Settings;
}

const KEY = 'vertijump:v1';

export const DEFAULT_SETTINGS: Settings = {
  units: 'in',
  defaultType: 'Countermovement',
  name: '',
  goalCm: null,
};

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppData>;
      return {
        version: 1,
        jumps: Array.isArray(parsed.jumps) ? parsed.jumps : [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      };
    }
  } catch {
    // fall through to defaults
  }
  return { version: 1, jumps: [], settings: { ...DEFAULT_SETTINGS } };
}

export function saveData(data: AppData): void {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function jumpsToCsv(jumps: JumpRecord[]): string {
  const header = 'date,height_cm,height_in,flight_time_ms,type,source,session_id,fps,method';
  const rows = jumps.map((j) =>
    [
      new Date(j.timestamp).toISOString(),
      j.heightCm.toFixed(1),
      (j.heightCm / 2.54).toFixed(1),
      Math.round(j.flightTimeMs),
      j.type,
      j.source,
      j.sessionId,
      j.fps ? Math.round(j.fps) : '',
      j.method ?? '',
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

export function makeDemoJumps(now = Date.now()): JumpRecord[] {
  const day = 86_400_000;
  const out: JumpRecord[] = [];
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const sessions = 14;
  for (let s = 0; s < sessions; s++) {
    const daysAgo = Math.round((sessions - 1 - s) * 3.2);
    const start = now - daysAgo * day - (18 - (s % 3)) * 3_600_000;
    const sessionId = `demo-${s}`;
    const level = 44 + s * 0.65 + (rand() - 0.5) * 2;
    const count = 4 + Math.floor(rand() * 5);
    for (let k = 0; k < count; k++) {
      const type: JumpType = k === count - 1 && s % 2 === 0 ? 'Approach' : 'Countermovement';
      const bonus = type === 'Approach' ? 7 : 0;
      const heightCm = Math.max(25, level + bonus + (rand() - 0.6) * 6 - k * 0.2);
      out.push({
        id: newId(),
        timestamp: start + k * 75_000,
        heightCm,
        flightTimeMs: Math.sqrt((8 * heightCm) / 100 / 9.80665) * 1000,
        type,
        sessionId,
        source: 'demo',
        fps: 60,
        method: 'fit',
      });
    }
  }
  return out;
}
