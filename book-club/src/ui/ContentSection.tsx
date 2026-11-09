import { useState } from 'react';
import { EntryFeed } from './EntryFeed';
import { PublicContent } from './Social';
import { Field } from './shared';
export function ContentSection({ bookId, memberId }: { bookId?: string; memberId?: string }) {
  const [section, setSection] = useState('quotes');
  return (
    <section className="public-content-section">
      <Field label="Записи участника">
        <select value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="quotes">Цитаты</option>
          <option value="note">Заметки</option>
          <option value="thought">Мысли</option>
          <option value="reviews">Отзывы и оценки</option>
        </select>
      </Field>
      {section === 'note' || section === 'thought' ? (
        <EntryFeed key={section} kind={section} bookId={bookId} memberId={memberId} />
      ) : (
        <PublicContent
          key={section}
          type={section as 'quotes' | 'reviews'}
          bookId={bookId}
          memberId={memberId}
        />
      )}
    </section>
  );
}
