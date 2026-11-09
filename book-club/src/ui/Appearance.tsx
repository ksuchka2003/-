import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB } from '../db';
import { paletteLabels, type Palette } from '../readerDomain';
import { Field, useTask, ErrorNote } from './shared';
import { applyTelegramTheme } from '../telegram';
export function useAppearance() {
  const palette = useLiveQuery(async () => (await getDB().settings.get('palette'))?.value) as
    Palette | undefined;
  const theme = useLiveQuery(async () => (await getDB().settings.get('theme'))?.value) as
    string | undefined;
  useEffect(() => {
    document.documentElement.dataset.palette =
      palette && palette in paletteLabels ? palette : 'library';
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
      <Field label="Палитра">
        <select
          disabled={busy}
          value={String(values[0]?.value || 'library')}
          onChange={(e) =>
            void run(() => getDB().settings.put({ key: 'palette', value: e.target.value }), '')
          }
        >
          {Object.entries(paletteLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Тема">
        <select
          disabled={busy}
          value={String(values[1]?.value || 'system')}
          onChange={(e) =>
            void run(() => getDB().settings.put({ key: 'theme', value: e.target.value }), '')
          }
        >
          <option value="system">Как в Telegram или на устройстве</option>
          <option value="light">Светлая</option>
          <option value="dark">Тёмная</option>
        </select>
      </Field>
      <ErrorNote text={error} />
    </section>
  );
}
