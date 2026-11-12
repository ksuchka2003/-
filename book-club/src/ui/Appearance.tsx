import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB } from '../db';
import { paletteLabels, activePalette, type Palette } from '../readerDomain';
import { useTask, ErrorNote } from './shared';
import { PaperSelect } from './PaperSelect';
import { applyTelegramTheme } from '../telegram';
export function useAppearance() {
  const palette = useLiveQuery(async () => (await getDB().settings.get('palette'))?.value) as
    Palette | undefined;
  const theme = useLiveQuery(async () => (await getDB().settings.get('theme'))?.value) as
    string | undefined;
  useEffect(() => {
    document.documentElement.dataset.palette = activePalette(palette);
  }, [palette]);
  useEffect(() => {
    document.documentElement.dataset.themePreference = ['light', 'dark'].includes(theme || '')
      ? theme
      : 'system';
    applyTelegramTheme();
  }, [theme]);
}
export function Appearance() {
  const values = useLiveQuery(() => getDB().settings.bulkGet(['palette', 'theme'])) || [];
  const { run, busy, error } = useTask();
  return (
    <section className="panel">
      <h2>Моё оформление</h2>
      <PaperSelect
        label="Палитра"
        disabled={busy}
        value={activePalette(values[0]?.value)}
        onChange={(value) => void run(() => getDB().settings.put({ key: 'palette', value }), '')}
        options={Object.entries(paletteLabels).map(([value, label]) => ({
          value,
          label,
          motif: value as Palette,
        }))}
      />
      <PaperSelect
        label="Тема"
        disabled={busy}
        value={String(values[1]?.value || 'system')}
        onChange={(value) => void run(() => getDB().settings.put({ key: 'theme', value }), '')}
        options={[
          { value: 'system', label: 'Как в Telegram или на устройстве' },
          { value: 'light', label: 'Светлая' },
          { value: 'dark', label: 'Тёмная' },
        ]}
      />
      <ErrorNote text={error} />
    </section>
  );
}
