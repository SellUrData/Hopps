import { describe, expect, it } from 'vitest';
import { G, flightTimeFromHeight } from './physics';
import { JumpDetector, sampleFromLandmarks, type DetectedJump, type LandmarkPoint } from './jumpDetector';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface SimOpts {
  fps: number;
  heightM: number;
  phase?: number;
  noise?: number;
  jumps?: number;
}

/** Simulates toe trajectory for one or more ballistic jumps after a still period. */
function simulate({ fps, heightM, phase = 0, noise = 0.0008, jumps = 1 }: SimOpts): DetectedJump[] {
  const det = new JumpDetector();
  const rand = rng(Math.round(fps * 1000 + heightM * 100 + phase * 10));
  const legLen = 0.25;
  const normPerM = legLen / 0.86;
  const baseline = 0.9;
  const T = flightTimeFromHeight(heightM);
  const v0 = (G * T) / 2;
  const takeoffs = Array.from({ length: jumps }, (_, k) => 1.5 + k * (T + 1.2));
  const end = takeoffs[takeoffs.length - 1] + T + 1;
  const out: DetectedJump[] = [];
  for (let i = 0; ; i++) {
    const t = (i + phase) / fps;
    if (t > end) break;
    let riseM = 0;
    for (const t0 of takeoffs) {
      const dt = t - t0;
      if (dt > 0 && dt < T) riseM = v0 * dt - (G * dt * dt) / 2;
    }
    const footY = baseline - riseM * normPerM + (rand() - 0.5) * 2 * noise;
    const u = det.push({ t, footY, legLen: legLen + (rand() - 0.5) * 0.002 });
    if (u.jump) out.push(u.jump);
  }
  return out;
}

describe('JumpDetector', () => {
  const cases: [number, number][] = [
    [240, 1.0],
    [120, 1.5],
    [60, 2.0],
    [30, 3.5],
  ];
  for (const [fps, tolCm] of cases) {
    for (const heightM of [0.25, 0.45, 0.7]) {
      it(`measures ${heightM * 100}cm at ${fps}fps within ${tolCm}cm`, () => {
        for (const phase of [0, 0.25, 0.5, 0.75]) {
          const jumps = simulate({ fps, heightM, phase });
          expect(jumps).toHaveLength(1);
          expect(Math.abs(jumps[0].heightM - heightM) * 100).toBeLessThan(tolCm);
        }
      });
    }
  }

  it('detects consecutive jumps', () => {
    const jumps = simulate({ fps: 60, heightM: 0.4, jumps: 3 });
    expect(jumps).toHaveLength(3);
    for (const j of jumps) expect(Math.abs(j.heightM - 0.4)).toBeLessThan(0.02);
  });

  it('ignores standing noise', () => {
    const det = new JumpDetector();
    const rand = rng(7);
    let jumps = 0;
    for (let i = 0; i < 600; i++) {
      const u = det.push({ t: i / 60, footY: 0.9 + (rand() - 0.5) * 0.004, legLen: 0.25 });
      if (u.jump) jumps++;
    }
    expect(jumps).toBe(0);
    expect(det.currentPhase).toBe('ready');
  });

  it('resets when the pose is lost', () => {
    const det = new JumpDetector();
    for (let i = 0; i < 60; i++) det.push({ t: i / 60, footY: 0.9, legLen: 0.25 });
    expect(det.currentPhase).toBe('ready');
    det.push({ t: 1.5, footY: null, legLen: null });
    expect(det.currentPhase).toBe('no-pose');
  });
});

describe('sampleFromLandmarks', () => {
  it('uses the lower toe and averages leg length', () => {
    const lm: LandmarkPoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
    lm[23] = { x: 0.45, y: 0.5, visibility: 1 };
    lm[24] = { x: 0.55, y: 0.5, visibility: 1 };
    lm[27] = { x: 0.45, y: 0.8, visibility: 1 };
    lm[28] = { x: 0.55, y: 0.8, visibility: 1 };
    lm[31] = { x: 0.44, y: 0.85, visibility: 1 };
    lm[32] = { x: 0.56, y: 0.83, visibility: 1 };
    const s = sampleFromLandmarks(1, lm);
    expect(s.footY).toBeCloseTo(0.85);
    expect(s.legLen).toBeCloseTo(0.3);
  });

  it('returns nulls without a pose', () => {
    expect(sampleFromLandmarks(0, undefined)).toEqual({ t: 0, footY: null, legLen: null });
  });
});
