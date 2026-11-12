import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { action } from '../cloud';
import { cachedIntro, cacheIntro, introSchema, type Intro } from '../clubIntro';
import { DraftNote, useDraft } from './useDraft';
import { Field, Loading, ErrorNote, useCloud, useTask } from './shared';

export function AdminIntro() {
  const settings = useCloud<{ key: string; value: unknown }>('club_settings');
  if (settings.isLoading) return <Loading />;
  if (settings.error) return <ErrorNote text={settings.error.message} />;
  const parsed = introSchema.safeParse(settings.data?.find((s) => s.key === 'intro')?.value);
  return <IntroEditor initial={parsed.success ? parsed.data : cachedIntro()} />;
}
function IntroEditor({ initial }: { initial: Intro }) {
  const [seed] = useState(initial);
  const draft = useDraft('admin:intro', seed),
    { run, busy, error } = useTask(),
    query = useQueryClient();
  const value = draft.value;
  if (!value) return <Loading />;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await run(async () => {
            const parsed = introSchema.parse(value);
            await action('admin.intro', parsed);
            cacheIntro(parsed);
            await draft.clear();
            await query.invalidateQueries({ queryKey: ['cloud'] });
          }, 'Вступительный текст сохранён')
        )
          location.hash = '/admin';
      }}
    >
      <DraftNote
        draft={draft}
        onLeave={() => {
          location.hash = '/admin';
        }}
      />
      <Field label="Заголовок первого экрана">
        <input
          required
          maxLength={100}
          value={value.title}
          onChange={(e) => draft.setValue({ ...value, title: e.target.value })}
        />
      </Field>
      <Field label="Текст первого экрана">
        <textarea
          required
          rows={10}
          maxLength={4000}
          value={value.text}
          onChange={(e) => draft.setValue({ ...value, text: e.target.value })}
        />
      </Field>
      <p className="hint">
        Этот текст увидят читатели при следующем входе. Переносы строк сохраняются.
      </p>
      <ErrorNote text={error} />
      <button className="primary" disabled={busy}>
        Сохранить вступление
      </button>
    </form>
  );
}
