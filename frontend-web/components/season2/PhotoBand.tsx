'use client';

import { useRef, useState, useId } from 'react';
import type { SeasonPhoto } from './content';
// The dialog primitive the landing page already ships: showModal()/close() driven
// from React state, with the scroll lock, Escape handling and focus handback.
import { useModalDialog } from '@/components/landing/useModalDialog';

/**
 * One `.photo-gallery` grid and its lightbox.
 *
 * The mock shared a single dialog across every gallery and swapped the photo
 * list on open; giving each band its own dialog does the same job with no
 * cross-component state, and prev/next still steps through exactly the band the
 * visitor clicked into. Frames marked `crop` reuse the wide montage image, which
 * is how the mock illustrated the scenes it has no photograph of.
 */
export default function PhotoBand({ label, photos, eager = false }: { label: string; photos: SeasonPhoto[]; eager?: boolean }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  // Every band carries its own dialog, so the caption's id has to be unique per band.
  const captionId = useId();
  const { ref, onSelfClick } = useModalDialog(open, () => setOpen(false), opener);

  const current = photos[index];
  const step = (direction: number) => setIndex((i) => (i + photos.length + direction) % photos.length);

  return (
    <>
      <div className="photo-gallery" role="group" aria-label={label}>
        {photos.map((photo, position) => (
          <figure className="gallery-card" key={`${photo.src}-${photo.caption}`}>
            <a
              href={photo.src}
              aria-label={`Enlarge ${photo.alt}`}
              onClick={(event) => {
                // A modifier click still opens the file itself, as the mock did.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                opener.current = event.currentTarget;
                setIndex(position);
                setOpen(true);
              }}
            >
              <span className={photo.crop ? `gallery-frame scene-crop scene-${photo.crop}` : 'gallery-frame'}>
                <img
                  src={photo.src}
                  alt={photo.alt}
                  loading={eager && position === 0 ? undefined : 'lazy'}
                  decoding="async"
                />
              </span>
              <span className="gallery-enlarge" aria-hidden="true">
                +
              </span>
            </a>
            <figcaption>
              <small>{photo.label}</small>
              {photo.caption}
            </figcaption>
          </figure>
        ))}
      </div>

      <dialog
        ref={ref}
        className="photo-dialog"
        aria-labelledby={captionId}
        onClick={(event) => {
          if (event.target === event.currentTarget) onSelfClick();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            step(event.key === 'ArrowRight' ? 1 : -1);
          }
        }}
      >
        <div className="photo-dialog-header">
          <span className="photo-count" aria-live="polite">
            {index + 1} / {photos.length}
          </span>
          <button type="button" aria-label="Close photo viewer" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        <div className={current.crop ? `photo-dialog-frame scene-crop scene-${current.crop}` : 'photo-dialog-frame'}>
          <img src={current.src} alt={current.alt} />
        </div>
        <p className="photo-caption" id={captionId}>
          {current.label} · {current.caption}
        </p>
        <div className="photo-dialog-controls" hidden={photos.length < 2}>
          <button type="button" onClick={() => step(-1)}>
            Previous
          </button>
          <button type="button" onClick={() => step(1)}>
            Next
          </button>
        </div>
      </dialog>
    </>
  );
}
