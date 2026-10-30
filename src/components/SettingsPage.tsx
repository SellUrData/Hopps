import { useRef } from 'react';
import { cmToUnits } from '../lib/physics';
import { JUMP_TYPES, jumpsToCsv, type AppData, type JumpType, type Settings } from '../lib/storage';

interface Props {
  data: AppData;
  onSettings: (s: Settings) => void;
  onImport: (d: AppData) => void;
  onLoadDemo: () => void;
  onClear: () => void;
}

const stamp = () => new Date().toISOString().slice(0, 10);

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SettingsPage({ data, onSettings, onImport, onLoadDemo, onClear }: Props) {
  const s = data.settings;
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Settings>) => onSettings({ ...s, ...patch });

  return (
    <div className="page">
      <header className="page-head"><h1>Settings</h1></header>

      <section className="card form">
        <label>
          Name
          <input value={s.name} placeholder="Athlete" onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="field" role="group" aria-labelledby="units-label">
          <span id="units-label">Units</span>
          <div className="segmented">
            <button aria-pressed={s.units === 'in'} className={s.units === 'in' ? 'on' : ''} onClick={() => set({ units: 'in' })}>Inches</button>
            <button aria-pressed={s.units === 'cm'} className={s.units === 'cm' ? 'on' : ''} onClick={() => set({ units: 'cm' })}>Centimeters</button>
          </div>
        </div>
        <label>
          Default jump type
          <select value={s.defaultType} onChange={(e) => set({ defaultType: e.target.value as JumpType })}>
            {JUMP_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Vertical goal ({s.units})
          <input
            type="number"
            inputMode="decimal"
            placeholder="e.g. 30"
            value={s.goalCm == null ? '' : Number(cmToUnits(s.goalCm, s.units).toFixed(1))}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              set({ goalCm: Number.isFinite(v) && v > 0 ? (s.units === 'in' ? v * 2.54 : v) : null });
            }}
          />
        </label>
      </section>

      <section className="card form">
        <h2>Data</h2>
        <p className="muted">Everything is stored on this device only.</p>
        <div className="btn-row">
          <button className="btn" disabled={!data.jumps.length} onClick={() => download(`vertijump-${stamp()}.csv`, jumpsToCsv(data.jumps), 'text/csv')}>Export CSV</button>
          <button className="btn" onClick={() => download(`vertijump-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json')}>Backup JSON</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Restore JSON</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const parsed = JSON.parse(await f.text()) as AppData;
            if (!Array.isArray(parsed.jumps)) throw new Error();
            onImport(parsed);
          } catch {
            alert('That file is not a VertiJump backup.');
          }
        }} />
        <div className="btn-row">
          <button className="btn" onClick={onLoadDemo}>Add demo data</button>
          <button className="btn danger" disabled={!data.jumps.length} onClick={() => {
            if (confirm('Delete all recorded jumps? This cannot be undone.')) onClear();
          }}>Delete all jumps</button>
        </div>
      </section>

      <section className="card tips">
        <h2>How it works</h2>
        <p className="muted">
          VertiJump tracks your toes with on-device pose detection (nothing is uploaded). It measures how long both feet are
          off the ground and converts flight time to height with h = g·t²/8 — the same method used by force-plate and
          contact-mat systems. No calibration or body measurements are needed.
        </p>
      </section>
    </div>
  );
}
