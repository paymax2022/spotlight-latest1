import type { SeasonPhoto } from './content';
import PhotoBand from './PhotoBand';

/**
 * One recap band: the section heading, its photographs, and the optional line
 * that hands the reader on. The mock drew two backdrops for these — a plain
 * panel and the wider purple "outside the mansion" band — which is all `tone`
 * decides.
 */
export default function RecapBand({
  id,
  tone = 'plain',
  eyebrow,
  title,
  copy,
  galleryLabel,
  photos,
  invitation,
}: {
  id: string;
  tone?: 'plain' | 'fans';
  eyebrow: string;
  title: [string, string];
  copy: string;
  galleryLabel: string;
  photos: SeasonPhoto[];
  invitation?: { text: string; label: string };
}) {
  const body = (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={`${id}-title`}>
            {title[0]}
            <br />
            <em>{title[1]}</em>
          </h2>
        </div>
        <p>{copy}</p>
      </div>
      <PhotoBand label={galleryLabel} photos={photos} />
      {invitation ? (
        <aside className="gallery-invitation">
          <p>{invitation.text}</p>
          <a className="button orange" href="#season-two">
            {invitation.label} <span aria-hidden="true">→</span>
          </a>
        </aside>
      ) : null}
    </>
  );

  return tone === 'fans' ? (
    <section id={id} className="fans section" aria-labelledby={`${id}-title`}>
      <div className="wrap">{body}</div>
    </section>
  ) : (
    <section id={id} className="section wrap" aria-labelledby={`${id}-title`}>
      {body}
    </section>
  );
}
