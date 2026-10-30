import { G, heightFromFlightTime } from './physics';

export interface LandmarkPoint {
  x: number;
  y: number;
  visibility?: number;
}

/** One processed video frame. Coordinates are normalized image coords (y grows downward). */
export interface FrameSample {
  t: number;
  footY: number | null;
  legLen: number | null;
}

export type DetectorPhase = 'no-pose' | 'calibrating' | 'ready' | 'airborne';

export interface DetectedJump {
  takeoffT: number;
  landingT: number;
  flightTime: number;
  heightM: number;
  method: 'fit' | 'crossing';
  airborneSamples: number;
}

export interface DetectorUpdate {
  phase: DetectorPhase;
  baseline: number | null;
  jump?: DetectedJump;
  rejected?: string;
}

export interface DetectorOptions {
  /** Toe rise (fraction of leg length) that triggers "airborne". */
  triggerFrac: number;
  /** Toe rise (fraction of leg length) treated as ground contact. */
  contactFrac: number;
  /** Seconds of stillness required to lock the ground baseline. */
  calibrationSec: number;
  /** Max toe movement (fraction of leg length) allowed while calibrating. */
  stillnessFrac: number;
  minFlight: number;
  maxFlight: number;
  /** Max seconds without a pose before tracking resets. */
  maxGap: number;
}

export const DEFAULT_OPTIONS: DetectorOptions = {
  triggerFrac: 0.06,
  contactFrac: 0.015,
  calibrationSec: 0.5,
  stillnessFrac: 0.025,
  minFlight: 0.12,
  maxFlight: 1.2,
  maxGap: 0.25,
};

const LM = { LHIP: 23, RHIP: 24, LANK: 27, RANK: 28, LTOE: 31, RTOE: 32 } as const;
const MIN_VIS = 0.3;

const visible = (p: LandmarkPoint | undefined): p is LandmarkPoint =>
  !!p && (p.visibility ?? 1) >= MIN_VIS;

/**
 * Extracts the lowest toe height (both feet must leave the ground to count as airborne)
 * and the leg length used to scale thresholds.
 */
export function sampleFromLandmarks(t: number, lm: LandmarkPoint[] | undefined): FrameSample {
  if (!lm || lm.length < 33) return { t, footY: null, legLen: null };
  const lt = lm[LM.LTOE];
  const rt = lm[LM.RTOE];
  const la = lm[LM.LANK];
  const ra = lm[LM.RANK];
  let footY: number | null = null;
  if (visible(lt) && visible(rt)) footY = Math.max(lt.y, rt.y);
  else if (visible(la) && visible(ra)) footY = Math.max(la.y, ra.y);

  const legs: number[] = [];
  for (const [h, a] of [
    [LM.LHIP, LM.LANK],
    [LM.RHIP, LM.RANK],
  ] as const) {
    const hp = lm[h];
    const ap = lm[a];
    if (visible(hp) && visible(ap)) legs.push(Math.hypot(hp.x - ap.x, hp.y - ap.y));
  }
  const legLen = legs.length ? legs.reduce((s, v) => s + v, 0) / legs.length : null;
  return { t, footY, legLen };
}

interface Valid {
  t: number;
  footY: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Least-squares quadratic y = a t^2 + b t + c (t centered for conditioning). */
function fitQuadratic(ts: number[], ys: number[]): { a: number; b: number; c: number; t0: number } | null {
  const n = ts.length;
  if (n < 3) return null;
  const t0 = ts.reduce((s, v) => s + v, 0) / n;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const x = ts[i] - t0;
    const x2 = x * x;
    s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
    y0 += ys[i]; y1 += ys[i] * x; y2 += ys[i] * x2;
  }
  // Normal equations: [[s4 s3 s2],[s3 s2 s1],[s2 s1 n]] [a b c]^T = [y2 y1 y0]^T
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const M = [
    [s4, s3, s2],
    [s3, s2, s1],
    [s2, s1, n],
  ];
  const D = det3(M);
  if (Math.abs(D) < 1e-18) return null;
  const rhs = [y2, y1, y0];
  const col = (k: number) => M.map((row, i) => row.map((v, j) => (j === k ? rhs[i] : v)));
  return { a: det3(col(0)) / D, b: det3(col(1)) / D, c: det3(col(2)) / D, t0 };
}

/**
 * Streaming flight-time jump detector.
 *
 * Locks a ground baseline for the toes while the athlete stands still, flags takeoff when
 * both feet rise past a threshold, and on landing estimates flight time by fitting a
 * ballistic parabola to the airborne toe trajectory (falling back to threshold crossings).
 * Jump height = g * T^2 / 8.
 */
export class JumpDetector {
  private opts: DetectorOptions;
  private phase: DetectorPhase = 'no-pose';
  private history: Valid[] = [];
  private baseline: number | null = null;
  private legLen: number | null = null;
  private lastValidT = -Infinity;
  private calibStart = 0;
  private airStartIdx = -1;
  private landingSince: number | null = null;

  constructor(opts: Partial<DetectorOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  get currentPhase(): DetectorPhase {
    return this.phase;
  }

  get currentBaseline(): number | null {
    return this.baseline;
  }

  reset(): void {
    this.phase = 'no-pose';
    this.history = [];
    this.baseline = null;
    this.legLen = null;
    this.lastValidT = -Infinity;
    this.airStartIdx = -1;
    this.landingSince = null;
  }

  private update(extra: Partial<DetectorUpdate> = {}): DetectorUpdate {
    return { phase: this.phase, baseline: this.baseline, ...extra };
  }

  private startCalibration(t: number): void {
    this.phase = 'calibrating';
    this.calibStart = t;
    this.airStartIdx = -1;
    this.landingSince = null;
  }

  push(s: FrameSample): DetectorUpdate {
    const o = this.opts;
    if (s.footY == null) {
      if (this.phase !== 'no-pose' && s.t - this.lastValidT > o.maxGap) {
        const wasAirborne = this.phase === 'airborne';
        this.reset();
        return this.update(wasAirborne ? { rejected: 'Lost tracking mid-jump' } : {});
      }
      return this.update();
    }

    if (s.legLen != null && this.phase !== 'airborne') {
      this.legLen = this.legLen == null ? s.legLen : this.legLen * 0.9 + s.legLen * 0.1;
    }
    if (this.legLen == null) return this.update();

    this.lastValidT = s.t;
    this.history.push({ t: s.t, footY: s.footY });
    const cutoff = s.t - (o.maxFlight + 2);
    let drop = 0;
    while (drop < this.history.length && this.history[drop].t < cutoff) drop++;
    if (drop) {
      this.history.splice(0, drop);
      if (this.airStartIdx >= 0) this.airStartIdx -= drop;
    }

    const L = this.legLen;
    switch (this.phase) {
      case 'no-pose':
        this.startCalibration(s.t);
        return this.update();

      case 'calibrating': {
        const win = this.history.filter((h) => h.t >= this.calibStart);
        const ys = win.map((h) => h.footY);
        if (Math.max(...ys) - Math.min(...ys) > o.stillnessFrac * L) {
          this.calibStart = s.t;
          return this.update();
        }
        if (s.t - this.calibStart >= o.calibrationSec && win.length >= 5) {
          this.baseline = median(ys);
          this.phase = 'ready';
        }
        return this.update();
      }

      case 'ready': {
        const base = this.baseline!;
        const rise = base - s.footY;
        if (rise > o.triggerFrac * L) {
          this.phase = 'airborne';
          this.airStartIdx = this.history.length - 1;
          this.landingSince = null;
          return this.update();
        }
        if (rise < -o.triggerFrac * L) {
          // Feet dropped well below the baseline: athlete or camera moved.
          this.baseline = null;
          this.startCalibration(s.t);
          return this.update();
        }
        if (Math.abs(rise) < 2 * o.contactFrac * L) {
          this.baseline = base * 0.97 + s.footY * 0.03;
        }
        return this.update();
      }

      case 'airborne': {
        const base = this.baseline!;
        const rise = base - s.footY;
        const startT = this.history[Math.max(0, this.airStartIdx)].t;
        if (s.t - startT > o.maxFlight + 0.3) {
          this.baseline = null;
          this.startCalibration(s.t);
          return this.update({ rejected: 'Airborne too long — recalibrating' });
        }
        if (rise < 0.5 * o.triggerFrac * L && this.landingSince == null) this.landingSince = s.t;
        if (this.landingSince != null && (rise <= o.contactFrac * L || s.t - this.landingSince > 0.12)) {
          const result = this.finalizeJump(base, L);
          this.phase = 'ready';
          this.airStartIdx = -1;
          this.landingSince = null;
          if ('error' in result) return this.update({ rejected: result.error });
          return this.update({ jump: result });
        }
        return this.update();
      }
    }
  }

  private finalizeJump(base: number, L: number): DetectedJump | { error: string } {
    const o = this.opts;
    const h = this.history;
    const rise = (i: number) => base - h[i].footY;
    const contact = o.contactFrac * L;
    const trig = this.airStartIdx;

    let apex = trig;
    for (let i = trig; i < h.length; i++) if (rise(i) > rise(apex)) apex = i;

    const cross = (i: number, j: number, level: number) => {
      const ri = rise(i);
      const rj = rise(j);
      if (rj === ri) return h[i].t;
      return h[i].t + ((level - ri) / (rj - ri)) * (h[j].t - h[i].t);
    };

    let takeoffT = h[trig].t;
    for (let i = trig; i > 0; i--) {
      if (rise(i - 1) <= contact) {
        takeoffT = cross(i - 1, i, contact);
        break;
      }
    }
    let landingT = h[h.length - 1].t;
    for (let i = apex; i < h.length - 1; i++) {
      if (rise(i + 1) <= contact) {
        landingT = cross(i, i + 1, contact);
        break;
      }
    }

    // Ballistic fit using frames clearly off the ground.
    const fitLevel = 2 * contact;
    const ts: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < h.length; i++) {
      if (h[i].t >= takeoffT && h[i].t <= landingT && rise(i) >= fitLevel) {
        ts.push(h[i].t);
        ys.push(rise(i));
      }
    }

    let flight = landingT - takeoffT;
    let heightM = heightFromFlightTime(flight);
    let method: DetectedJump['method'] = 'crossing';

    const fit = ts.length >= 5 ? fitQuadratic(ts, ys) : null;
    if (fit && fit.a < 0) {
      const disc = fit.b * fit.b - 4 * fit.a * fit.c;
      if (disc > 0) {
        const r1 = (-fit.b + Math.sqrt(disc)) / (2 * fit.a) + fit.t0;
        const r2 = (-fit.b - Math.sqrt(disc)) / (2 * fit.a) + fit.t0;
        const t1 = Math.min(r1, r2);
        const t2 = Math.max(r1, r2);
        const fitFlight = t2 - t1;
        const slack = Math.max(0.06, 0.25 * flight);
        if (Math.abs(fitFlight - flight) <= slack) {
          takeoffT = t1;
          landingT = t2;
          flight = fitFlight;
          heightM = heightFromFlightTime(flight);
          method = 'fit';
        }
      }
    }

    if (flight < o.minFlight) return { error: 'Too short to be a jump' };
    if (flight > o.maxFlight) return { error: 'Airborne too long to be a jump' };
    return { takeoffT, landingT, flightTime: flight, heightM, method, airborneSamples: ts.length };
  }
}

export { G };
