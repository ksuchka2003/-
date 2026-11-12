import { Cover } from './shared';
import { PaperFragment, PaperTape, BookmarkTab } from './EditorialArt';
import { PaletteMotif } from './PaletteMotif';

/** The same tucked paper and bookmark work at both card and list sizes. */
export function BookJacket({
  title,
  cover,
  reading = false,
}: {
  title: string;
  cover?: string;
  reading?: boolean;
}) {
  return (
    <div className="book-jacket">
      <PaperFragment className="jacket-paper" />
      <Cover title={title} cover={cover || ''} />
      <PaperTape className="jacket-tape" />
      <PaletteMotif className="jacket-motif" />
      {reading && <BookmarkTab />}
    </div>
  );
}
