'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { chooserOptions } from './content';
import { ArrowIcon } from './Icons';
import { useModalDialog } from './useModalDialog';

interface JoinApi {
  open: (opener: HTMLElement) => void;
}

const JoinContext = createContext<JoinApi | null>(null);

export function useJoinDialog(): JoinApi {
  const ctx = useContext(JoinContext);
  if (!ctx) throw new Error('JoinTrigger must render inside JoinDialogProvider');
  return ctx;
}

/** Any element that asks the chooser to open, in the header, journey and closing bands. */
export function JoinTrigger({ className, children }: { className: string; children: ReactNode }) {
  const { open } = useJoinDialog();
  return (
    <button type="button" className={className} onClick={(event) => open(event.currentTarget)}>
      {children}
      <ArrowIcon />
    </button>
  );
}

export function JoinDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(chooserOptions[0].key);
  const opener = useRef<HTMLElement | null>(null);
  const router = useRouter();

  const close = useCallback(() => setOpen(false), []);

  const { ref, onSelfClick } = useModalDialog(open, close, opener);

  const api = useMemo<JoinApi>(
    () => ({
      open: (element) => {
        opener.current = element;
        setOpen(true);
      },
    }),
    [],
  );

  const chosen = chooserOptions.find((option) => option.key === selected) ?? chooserOptions[0];

  function goTo(href: string, external: boolean) {
    setOpen(false);
    // WhatsApp is the only external path, and it matches the programme card's
    // own `target="_blank"` CTA: the enquiry opens beside the page rather than
    // replacing it.
    if (external) window.open(href, '_blank', 'noopener');
    else router.push(href);
  }

  return (
    <JoinContext.Provider value={api}>
      {children}
      <dialog
        ref={ref}
        className="join-dialog"
        aria-labelledby="join-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) onSelfClick();
        }}
      >
        <div className="dialog-head">
          <span className="eyebrow dark">LET’S FIND YOUR WORLD</span>
          <button type="button" className="dialog-close" aria-label="Close programme chooser" onClick={close}>
            ×
          </button>
        </div>
        <h2 id="join-title">
          What’s your<br />
          <em>next big move?</em>
        </h2>
        <p>Choose a path to explore its current details.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            goTo(chosen.href, chosen.external);
          }}
        >
          <fieldset>
            <legend className="sr-only">Choose a programme</legend>
            {chooserOptions.map((option) => (
              <label key={option.key}>
                <input
                  type="radio"
                  name="path"
                  value={option.key}
                  checked={option.key === selected}
                  onChange={() => setSelected(option.key)}
                />
                <span>
                  {option.name}
                  <small>{option.sub}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="dialog-hint">{chosen.hint}</p>
          <button type="submit" className="button ink">
            {chosen.submit} <ArrowIcon />
          </button>
        </form>
      </dialog>
    </JoinContext.Provider>
  );
}
