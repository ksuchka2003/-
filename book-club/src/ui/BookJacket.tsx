import { Cover } from './shared';
import { BookmarkTab } from './EditorialArt';

/** Plain covers in lists and cards; only the reading bookmark stays. */
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
      <Cover title={title} cover={cover || ''} />
      {reading && <BookmarkTab />}
    </div>
  );
}
