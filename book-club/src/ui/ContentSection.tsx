import { useState } from 'react';
import { EntryFeed } from './EntryFeed';
import { PublicContent } from './Social';
import { PaperSelect } from './PaperSelect';
export function ContentSection({ bookId, memberId }: { bookId?: string; memberId?: string }) {
  const [section, setSection] = useState('quotes');
  return (
    <section className="public-content-section">
      <PaperSelect
        label="Записи участника"
        value={section}
        onChange={setSection}
        options={[
          { value: 'quotes', label: 'Цитаты' },
          { value: 'note', label: 'Заметки' },
          { value: 'thought', label: 'Мысли' },
          { value: 'reviews', label: 'Отзывы и оценки' },
        ]}
      />
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
