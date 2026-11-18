'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { mansionChapters, sceneStrip, type MansionChapter } from './content';
import PhotoBand from './PhotoBand';

/**
 * The chapters are native `<details>` panels, and two things drive them: the
 * visitor clicking a summary, and the scene strip above, which the mock used to
 * open the chapter it was pointing at. Both go through this state so React and
 * the DOM never disagree about what is open.
 */
interface ChaptersApi {
  isOpen: (id: string) => boolean;
  reveal: (id: string) => void;
  setChapter: (id: string, next: boolean) => void;
}

const ChaptersContext = createContext<ChaptersApi | null>(null);

function useChapters(): ChaptersApi {
  const ctx = useContext(ChaptersContext);
  if (!ctx) throw new Error('SceneStrip and MansionChapters must render inside ChaptersProvider');
  return ctx;
}

export function ChaptersProvider({ children }: { children: ReactNode }) {
  const [openIds, setOpenIds] = useState<string[]>(() => [mansionChapters[0].id]);

  const setChapter = useCallback((id: string, next: boolean) => {
    setOpenIds((current) => {
      if (current.includes(id) === next) return current;
      return next ? [...current, id] : current.filter((open) => open !== id);
    });
  }, []);

  const api = useMemo<ChaptersApi>(
    () => ({
      isOpen: (id) => openIds.includes(id),
      reveal: (id) => setChapter(id, true),
      setChapter,
    }),
    [openIds, setChapter],
  );

  return <ChaptersContext.Provider value={api}>{children}</ChaptersContext.Provider>;
}

/** The six numbered links under the hero: they jump to, and open, each chapter. */
export function SceneStrip() {
  const { reveal } = useChapters();
  return (
    <nav className="scene-strip" aria-label="Mansion highlights">
      {sceneStrip.map((item) => (
        <a
          key={item.href}
          href={item.href}
          onClick={() => {
            // The #finale target is a section, not a chapter, so revealing it is
            // a no-op and the browser still scrolls.
            reveal(item.href.slice(1));
          }}
        >
          {item.number} <span>{item.label}</span>
        </a>
      ))}
    </nav>
  );
}

export default function MansionChapters() {
  return (
    <div className="mansion-chapters">
      {mansionChapters.map((chapter) => (
        <Chapter key={chapter.id} chapter={chapter} />
      ))}
    </div>
  );
}

function Chapter({ chapter }: { chapter: MansionChapter }) {
  const { isOpen, setChapter } = useChapters();
  return (
    <details
      id={chapter.id}
      open={isOpen(chapter.id)}
      onToggle={(event) => setChapter(chapter.id, event.currentTarget.open)}
    >
      <summary>
        <span>{chapter.kicker}</span>
        <strong>{chapter.title}</strong>
        <b aria-hidden="true">+</b>
      </summary>
      <p>{chapter.body}</p>
      <PhotoBand label={`${chapter.title} gallery`} photos={chapter.photos} />
    </details>
  );
}
