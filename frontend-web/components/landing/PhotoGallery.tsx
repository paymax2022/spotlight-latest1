'use client';

import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { gallery, galleryFilters, type GalleryPhoto } from './content';
import { useModalDialog } from './useModalDialog';

type Filter = (typeof galleryFilters)[number]['key'];

export default function PhotoGallery() {
  const [filter, setFilter] = useState<Filter>('all');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const opener = useRef<HTMLElement | null>(null);

  const shown = gallery
    .map((photo, index) => ({ photo, index }))
    .filter(({ photo }) => filter === 'all' || photo.category === filter);

  return (
    <>
      <section className="moments wrap" id="gallery" aria-labelledby="gallery-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">06 / INSIDE THE SPOTLIGHT</p>
            <h2 id="gallery-title">
              Real people.
              <br />
              <em>Unforgettable moments.</em>
            </h2>
          </div>
          <p className="supporting-copy">
            From the house to the stage and screen.
            <br />
            A photo journal of the Spotlight community.
          </p>
        </div>

        <div className="gallery-filters" role="group" aria-label="Filter photo gallery">
          {galleryFilters.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={option.key === filter}
              onClick={() => setFilter(option.key as Filter)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="photo-gallery">
          {shown.map(({ photo, index }) => (
            <button
              key={photo.image}
              type="button"
              className="gallery-photo"
              aria-label={`View photo: ${photo.title}`}
              onClick={(event) => {
                opener.current = event.currentTarget;
                setPhotoIndex(index);
                setViewerOpen(true);
              }}
            >
              <img src={photo.image} alt={photo.title} loading="lazy" decoding="async" />
              <span className="gallery-caption">
                <small>{photo.label}</small>
                <strong>{photo.title}</strong>
              </span>
              <span className="gallery-expand" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </div>

        <div className="gallery-foot">
          <span aria-live="polite">{`${String(shown.length).padStart(2, '0')} MOMENTS`}</span>
          <p>Photography from the Spotlight gallery. Select a photo to view it in full.</p>
        </div>
      </section>

      <PhotoViewer
        open={viewerOpen}
        index={photoIndex}
        onStep={setPhotoIndex}
        onClose={() => setViewerOpen(false)}
        opener={opener}
      />
    </>
  );
}

/**
 * Prev/next step through the whole journal rather than the filtered handful, so
 * a visitor who came in through "On stage" still reaches everything else —
 * matching the behaviour the mock shipped. The dialog stays mounted so closing
 * it can hand focus back to the thumbnail after the browser has finished
 * restoring its own focus.
 */
function PhotoViewer({
  open,
  index,
  onStep,
  onClose,
  opener,
}: {
  open: boolean;
  index: number;
  onStep: Dispatch<SetStateAction<number>>;
  onClose: () => void;
  opener: RefObject<HTMLElement | null>;
}) {
  const { ref, onSelfClick } = useModalDialog(open, onClose, opener);
  const photo: GalleryPhoto = gallery[index];
  // Read from the queue rather than the `index` prop, so two clicks in one
  // frame step twice instead of both computing the same target.
  const step = (direction: number) => onStep((current) => (current + gallery.length + direction) % gallery.length);

  return (
    <dialog
      ref={ref}
      className="media-dialog"
      aria-labelledby="photo-dialog-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelfClick();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          step(1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          step(-1);
        }
      }}
    >
      <div className="media-dialog-bar">
        <p id="photo-dialog-title">{photo.title}</p>
        <button type="button" aria-label="Close photo viewer" onClick={onClose}>
          ×
        </button>
      </div>
      <img src={photo.image} alt={photo.title} />
      <div className="photo-dialog-foot">
        <button type="button" aria-label="Previous photo" onClick={() => step(-1)}>
          ←
        </button>
        <p aria-live="polite">
          {index + 1} / {gallery.length} · {photo.label}
        </p>
        <button type="button" aria-label="Next photo" onClick={() => step(1)}>
          →
        </button>
      </div>
    </dialog>
  );
}
