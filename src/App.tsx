import { useEffect, useState } from 'react';
import Dashboard from './components/Dashboard';
import History from './components/History';
import Icon, { type IconName } from './components/Icon';
import Measure from './components/Measure';
import SettingsPage from './components/SettingsPage';
import { DEFAULT_SETTINGS, loadData, makeDemoJumps, saveData, type AppData } from './lib/storage';

type Tab = 'dashboard' | 'measure' | 'history' | 'settings';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'measure', label: 'Measure', icon: 'camera' },
  { id: 'history', label: 'History', icon: 'list' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];

export default function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [tab, setTab] = useState<Tab>('dashboard');

  useEffect(() => saveData(data), [data]);
  useEffect(() => window.scrollTo(0, 0), [tab]);

  const loadDemo = () =>
    setData((d) => ({ ...d, jumps: [...d.jumps.filter((j) => j.source !== 'demo'), ...makeDemoJumps()] }));

  return (
    <div className="app">
      <main>
        {tab === 'dashboard' && (
          <Dashboard jumps={data.jumps} settings={data.settings} onMeasure={() => setTab('measure')} onLoadDemo={loadDemo} />
        )}
        {tab === 'measure' && (
          <Measure
            settings={data.settings}
            onJump={(j) => setData((d) => ({ ...d, jumps: [...d.jumps, j] }))}
            onDelete={(id) => setData((d) => ({ ...d, jumps: d.jumps.filter((j) => j.id !== id) }))}
          />
        )}
        {tab === 'history' && (
          <History
            jumps={data.jumps}
            settings={data.settings}
            onDelete={(id) => setData((d) => ({ ...d, jumps: d.jumps.filter((j) => j.id !== id) }))}
          />
        )}
        {tab === 'settings' && (
          <SettingsPage
            data={data}
            onSettings={(settings) => setData((d) => ({ ...d, settings }))}
            onImport={(imported) =>
              setData({ version: 1, jumps: imported.jumps, settings: { ...DEFAULT_SETTINGS, ...imported.settings } })
            }
            onLoadDemo={loadDemo}
            onClear={() => setData((d) => ({ ...d, jumps: [] }))}
          />
        )}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
