import scrapbookAtlas from '../assets/illustrations/scrapbook-atlas.webp';
import { PaperFragment, PaperTape } from './EditorialArt';

export type ScrapbookMotif = 'flowers' | 'butterfly' | 'moon' | 'stamp';

export function ScrapbookImage({
  motif,
  className = '',
}: {
  motif: ScrapbookMotif;
  className?: string;
}) {
  return (
    <span className={`scrapbook-image scrapbook-${motif} ${className}`} aria-hidden="true">
      <img src={scrapbookAtlas} alt="" loading="lazy" decoding="async" draggable="false" />
    </span>
  );
}

const companions: Record<ScrapbookMotif, ScrapbookMotif> = {
  flowers: 'stamp',
  butterfly: 'flowers',
  moon: 'butterfly',
  stamp: 'butterfly',
};

/** A separate decorative collage, with no people, controls or publication data. */
export function CreativeInsert({
  motif,
  className = '',
}: {
  motif: ScrapbookMotif;
  className?: string;
}) {
  return (
    <div className={`creative-insert creative-${motif} ${className}`} aria-hidden="true">
      <PaperFragment className="creative-paper" ruled={motif === 'flowers'} />
      <PaperTape />
      <ScrapbookImage motif={motif} className="creative-primary" />
      <ScrapbookImage motif={companions[motif]} className="creative-companion" />
    </div>
  );
}
