import { useEffect, useRef, useState } from 'react';
import { DrawingUtils, PoseLandmarker } from '@mediapipe/tasks-vision';
import { JumpDetector, sampleFromLandmarks, type DetectedJump, type DetectorPhase } from '../lib/jumpDetector';
import { detectPose, getPoseLandmarker } from '../lib/pose';
import { formatHeight } from '../lib/physics';
import { JUMP_TYPES, newId, type JumpRecord, type JumpType, type Settings } from '../lib/storage';
import Icon from './Icon';

type Mode = 'live' | 'video';
type Status = 'idle' | 'loading' | 'running' | 'done' | 'error';

interface Props {
  settings: Settings;
  onJump: (j: JumpRecord) => void;
  onDelete: (id: string) => void;
}

const PHASE_TEXT: Record<DetectorPhase, string> = {
  'no-pose': 'Step back — full body and feet in frame',
  calibrating: 'Hold still…',
  ready: 'Ready — jump!',
  airborne: 'In the air…',
};

function cameraError(e: unknown): string {
  if (!navigator.mediaDevices?.getUserMedia) return 'Camera needs a secure (https) connection.';
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError') return 'Camera permission denied. Allow camera access and try again.';
  if (name === 'NotFoundError') return 'No camera found on this device.';
  return e instanceof Error ? e.message : 'Could not start the camera.';
}

export default function Measure({ settings, onJump, onDelete }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const urlRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const sessionRef = useRef(newId());
  const typeRef = useRef<JumpType>(settings.defaultType);
  const slowRef = useRef(1);
  const fpsRef = useRef(0);

  const [mode, setMode] = useState<Mode>('live');
  const [status, setStatus] = useState<Status>('idle');
  const [phase, setPhase] = useState<DetectorPhase>('no-pose');
  const [message, setMessage] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [jumpType, setJumpType] = useState<JumpType>(settings.defaultType);
  const [slowFactor, setSlowFactor] = useState(1);
  const [speed, setSpeed] = useState(0.25);
  const [progress, setProgress] = useState(0);
  const [sessionJumps, setSessionJumps] = useState<JumpRecord[]>([]);
  const [flash, setFlash] = useState<JumpRecord | null>(null);

  useEffect(() => {
    typeRef.current = jumpType;
    slowRef.current = slowFactor;
  }, [jumpType, slowFactor]);

  const stop = () => {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.srcObject = null;
    }
  };

  useEffect(() => () => {
    stop();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const recordJump = (j: DetectedJump, source: 'live' | 'video') => {
    const rec: JumpRecord = {
      id: newId(),
      timestamp: Date.now(),
      heightCm: j.heightM * 100,
      flightTimeMs: j.flightTime * 1000,
      type: typeRef.current,
      sessionId: sessionRef.current,
      source,
      fps: fpsRef.current || undefined,
      method: j.method,
    };
    onJump(rec);
    setSessionJumps((prev) => [rec, ...prev]);
    setFlash(rec);
    navigator.vibrate?.(60);
  };

  const runLoop = async (source: Mode) => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const drawer = new DrawingUtils(ctx);
    const landmarker = await getPoseLandmarker();
    const detector = new JumpDetector();
    let lastPhase: DetectorPhase | null = null;
    let lastMediaT = -1;
    let frames = 0;
    let windowStart = -1;
    let lastProgress = 0;
    const debugTrace = new URLSearchParams(location.search).has('debug') ? [] as unknown[] : null;
    if (debugTrace) (window as unknown as { __vjTrace: unknown[] }).__vjTrace = debugTrace;

    const draw = (lm: ReturnType<typeof detectPose>['landmarks'][number] | undefined, baseline: number | null, airborne: boolean) => {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = Math.max(1, canvas.width / 640);
      if (baseline != null) {
        ctx.save();
        ctx.setLineDash([12 * scale, 10 * scale]);
        ctx.strokeStyle = airborne ? '#38bdf8' : 'rgba(198,255,61,0.85)';
        ctx.lineWidth = 3 * scale;
        ctx.beginPath();
        ctx.moveTo(0, baseline * canvas.height);
        ctx.lineTo(canvas.width, baseline * canvas.height);
        ctx.stroke();
        ctx.restore();
      }
      if (!lm) return;
      drawer.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: 'rgba(255,255,255,0.75)', lineWidth: 3 * scale });
      drawer.drawLandmarks(lm, { color: airborne ? '#38bdf8' : '#c6ff3d', fillColor: '#0b0f17', radius: 3 * scale, lineWidth: 2 * scale });
      drawer.drawLandmarks([lm[31], lm[32]], { color: '#c6ff3d', fillColor: '#c6ff3d', radius: 6 * scale });
    };

    const step = (now: number, meta?: VideoFrameCallbackMetadata) => {
      if (!runningRef.current) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const mediaT = meta?.mediaTime ?? video.currentTime;
        if (mediaT !== lastMediaT || source === 'live') {
          lastMediaT = mediaT;
          const t = source === 'live' ? (meta?.captureTime ?? now) / 1000 : mediaT / slowRef.current;
          const result = detectPose(landmarker, video);
          const lm = result.landmarks[0];
          const sample = sampleFromLandmarks(t, lm);
          const update = detector.push(sample);
          if (debugTrace) debugTrace.push({ ...sample, phase: update.phase, baseline: update.baseline, jump: update.jump });
          draw(lm, update.baseline, update.phase === 'airborne');
          if (update.phase !== lastPhase) {
            lastPhase = update.phase;
            setPhase(update.phase);
          }
          if (update.jump) recordJump(update.jump, source);
          if (update.rejected) setMessage(update.rejected);

          frames++;
          if (windowStart < 0) windowStart = t;
          if (t - windowStart >= 1) {
            fpsRef.current = frames / (t - windowStart);
            setFps(Math.round(fpsRef.current));
            frames = 0;
            windowStart = t;
          }
          if (source === 'video' && now - lastProgress > 200 && video.duration) {
            lastProgress = now;
            setProgress(video.currentTime / video.duration);
          }
        }
      }
      schedule();
    };
    const schedule = () => {
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(step);
      else requestAnimationFrame((n) => step(n));
    };
    schedule();
  };

  const startLive = async (face = facing) => {
    stop();
    setMessage(null);
    setFlash(null);
    setStatus('loading');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
      const [stream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: face, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
        }),
        getPoseLandmarker(),
      ]);
      const video = videoRef.current!;
      if (urlRef.current) video.removeAttribute('src');
      streamRef.current = stream;
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      runningRef.current = true;
      setStatus('running');
      void runLoop('live');
    } catch (e) {
      stop();
      setStatus('error');
      setMessage(cameraError(e));
    }
  };

  const analyzeFile = async (file: File) => {
    stop();
    setMessage(null);
    setFlash(null);
    setProgress(0);
    setStatus('loading');
    try {
      const video = videoRef.current!;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(file);
      const loaded = new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('Could not read that video file.'));
      });
      video.srcObject = null;
      video.src = urlRef.current;
      video.muted = true;
      await Promise.all([loaded, getPoseLandmarker()]);
      video.currentTime = 0;
      video.playbackRate = speed;
      video.onended = () => {
        runningRef.current = false;
        setProgress(1);
        setStatus('done');
      };
      runningRef.current = true;
      setStatus('running');
      void runLoop('video');
      await video.play();
    } catch (e) {
      stop();
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Could not analyze video.');
    }
  };

  const switchMode = (m: Mode) => {
    stop();
    setStatus('idle');
    setMessage(null);
    setFlash(null);
    setMode(m);
  };

  const flipCamera = () => {
    const next = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    if (status === 'running') void startLive(next);
  };

  const running = status === 'running';
  const best = sessionJumps.reduce((b, j) => Math.max(b, j.heightCm), 0);
  const mirrored = mode === 'live' && facing === 'user';

  return (
    <div className="page">
      <header className="page-head">
        <h1>Measure</h1>
        <div className="segmented">
          <button className={mode === 'live' ? 'on' : ''} onClick={() => switchMode('live')}>Live camera</button>
          <button className={mode === 'video' ? 'on' : ''} onClick={() => switchMode('video')}>Upload video</button>
        </div>
      </header>

      <div className="chips">
        {JUMP_TYPES.map((t) => (
          <button key={t} className={`chip ${jumpType === t ? 'on' : ''}`} onClick={() => setJumpType(t)}>{t}</button>
        ))}
      </div>

      <div className={`stage ${mirrored ? 'mirrored' : ''} ${phase === 'airborne' && running ? 'air' : ''}`}>
        <video ref={videoRef} playsInline muted poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" />
        <canvas ref={canvasRef} />
        {running && <div className={`pill phase-${phase}`}>{PHASE_TEXT[phase]}</div>}
        {running && fps > 0 && <div className={`fps ${fps < 25 ? 'low' : ''}`}>{fps} fps</div>}
        {status === 'loading' && <div className="stage-msg">Loading pose model…</div>}
        {(status === 'idle' || status === 'error') && (
          <div className="stage-msg">
            <Icon name={mode === 'live' ? 'camera' : 'upload'} size={40} />
            <p>{mode === 'live' ? 'Prop your phone up 2–3 m away so your whole body and feet are visible.' : 'Pick a clip that starts with you standing still for a moment.'}</p>
          </div>
        )}
        {flash && (
          <div className="result-flash" key={flash.id}>
            <span className="big">{formatHeight(flash.heightCm, settings.units)}</span>
            <span className="sub">{Math.round(flash.flightTimeMs)} ms flight</span>
          </div>
        )}
        {mode === 'video' && (running || status === 'done') && (
          <div className="progress"><div style={{ width: `${progress * 100}%` }} /></div>
        )}
      </div>

      {message && <div className="notice">{message}</div>}

      {mode === 'live' ? (
        <div className="controls">
          {running ? (
            <button className="btn danger" onClick={() => { stop(); setStatus('idle'); }}>Stop</button>
          ) : (
            <button className="btn primary" disabled={status === 'loading'} onClick={() => startLive()}>
              <Icon name="camera" /> Start camera
            </button>
          )}
          <button className="btn icon" onClick={flipCamera} aria-label="Flip camera"><Icon name="flip" /></button>
        </div>
      ) : (
        <div className="video-controls">
          <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void analyzeFile(f);
            e.target.value = '';
          }} />
          <div className="row">
            <label>
              Analysis speed
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                <option value={0.5}>Fast (0.5×)</option>
                <option value={0.25}>Normal (0.25×)</option>
                <option value={0.1}>Thorough (0.1×)</option>
              </select>
            </label>
            <label>
              Clip is slowed down
              <select value={slowFactor} onChange={(e) => setSlowFactor(Number(e.target.value))}>
                <option value={1}>No (real time)</option>
                <option value={4}>4× (120 fps slo-mo)</option>
                <option value={8}>8× (240 fps slo-mo)</option>
              </select>
            </label>
          </div>
          <button className="btn primary" disabled={status === 'loading' || running} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" /> {running ? 'Analyzing…' : 'Choose video'}
          </button>
        </div>
      )}

      {sessionJumps.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>This session</h2>
            <span className="muted">{sessionJumps.length} jumps · best {formatHeight(best, settings.units)}</span>
          </div>
          <ul className="jump-list">
            {sessionJumps.map((j, i) => (
              <li key={j.id}>
                <span className="idx">#{sessionJumps.length - i}</span>
                <span className="h">{formatHeight(j.heightCm, settings.units)}</span>
                <span className="muted">{Math.round(j.flightTimeMs)} ms</span>
                <button className="btn icon ghost" aria-label="Delete jump" onClick={() => {
                  onDelete(j.id);
                  setSessionJumps((prev) => prev.filter((x) => x.id !== j.id));
                  if (flash?.id === j.id) setFlash(null);
                }}><Icon name="trash" size={18} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card tips">
        <h2>Tips for accurate results</h2>
        <ul>
          <li>Keep the phone still (lean it on something) with the camera at about knee height.</li>
          <li>Stand still for half a second before each jump so the app can find the floor.</li>
          <li>Jump straight up and keep your legs straight in the air — tucking adds fake height.</li>
          <li>Land on your toes in the same spot you took off from.</li>
          <li>Higher fps = more accurate. For the best results, record in slow-mo (120/240 fps) and upload the clip.</li>
        </ul>
      </section>
    </div>
  );
}
