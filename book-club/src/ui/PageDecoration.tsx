import { PaletteMotif } from './PaletteMotif';
export function PageDecoration({ name }: { name: string }) {
  return (
    <div className="page-palette-decor" aria-hidden="true">
      <PaletteMotif variant={name} />
    </div>
  );
}
