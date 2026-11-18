'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useModalDialog } from '@/components/landing/useModalDialog';
import { ArrowIcon } from './Icons';

/**
 * What the page knows about the application, resolved on the server from the
 * contest definition and the recorded season — see app/season-2/page.tsx.
 */
export interface SeasonFacts {
  /** The route that actually starts an application. Always resolvable. */
  applyHref: string;
  programmeName: string;
  /** The season record's own name, when one has been entered. */
  seasonName: string | null;
  /** e.g. "₦5,000", or null when the programme does not charge. */
  feeLabel: string | null;
  /** Audition dates from the recorded season, or null while none are set. */
  windowLabel: string | null;
  /** Requirements the application form itself asks about. */
  eligibility: string[];
}

interface PanelApi {
  open: (opener: HTMLElement) => void;
}

const PanelContext = createContext<PanelApi | null>(null);

export function useRegistrationPanel(): PanelApi {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error('RegistrationTrigger must render inside RegistrationPanelProvider');
  return ctx;
}

/** Any element that opens the panel — the header, the hero and the Season 2 band. */
export function RegistrationTrigger({ className, children }: { className?: string; children: ReactNode }) {
  const { open } = useRegistrationPanel();
  return (
    <button type="button" className={className} onClick={(event) => open(event.currentTarget)}>
      {children}
    </button>
  );
}

/**
 * The mock's registration drawer collected a full application and then handed
 * back a JSON file for the visitor to keep — it stored nothing. This panel keeps
 * the mock's chrome but tells the truth about what happens next: it lists the
 * sections the real form asks for and links into it, because that form is what
 * writes an application to the database.
 */
export function RegistrationPanelProvider({ facts, children }: { facts: SeasonFacts; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const { ref, onSelfClick } = useModalDialog(open, close, opener);

  const api = useMemo<PanelApi>(
    () => ({
      open: (element) => {
        opener.current = element;
        setOpen(true);
      },
    }),
    [],
  );

  return (
    <PanelContext.Provider value={api}>
      {children}
      <dialog
        ref={ref}
        className="form-panel"
        aria-labelledby="registration-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) onSelfClick();
        }}
      >
        <header className="form-panel-header">
          <div>
            <p className="eyebrow">SPOTLIGHT REALITY TV / SEASON 02</p>
            <h2 id="registration-title">Your audition starts here.</h2>
          </div>
          <button type="button" className="panel-close" aria-label="Close registration information" onClick={close}>
            ×
          </button>
        </header>

        <div className="panel-form">
          <p className="panel-intro">
            Applications are taken on Spotlight's own form, and only there: it writes your entry to the review team's
            queue. You sign in first, so an application you start can be picked up again on any device.
          </p>

          <fieldset>
            <legend>
              <span>01</span> What the form asks
            </legend>
            <ol className="panel-steps">
              <li>
                <strong>Contest selection</strong> Confirm the programme you are applying to.
              </li>
              <li>
                <strong>Profile information</strong> Names, stage name, date of birth, gender, nationality, state of
                origin and residence, address, phone and WhatsApp number.
              </li>
              <li>
                <strong>Reality show requirements</strong> Your talent and experience, ID and photo uploads, bootcamp
                availability, medical history, social reach and the fee payment.
              </li>
              <li>
                <strong>Consent and submit</strong> Declarations, media and conduct consents, then submission.
              </li>
            </ol>
          </fieldset>

          <fieldset>
            <legend>
              <span>02</span> Before you start
            </legend>
            <dl className="panel-facts">
              <div>
                <dt>PROGRAMME</dt>
                <dd>{facts.programmeName}</dd>
              </div>
              {facts.seasonName ? (
                <div>
                  <dt>SEASON</dt>
                  <dd>{facts.seasonName}</dd>
                </div>
              ) : null}
              <div>
                <dt>AUDITION WINDOW</dt>
                <dd>{facts.windowLabel ?? 'To be announced'}</dd>
              </div>
              <div>
                <dt>APPLICATION FEE</dt>
                <dd>{facts.feeLabel ?? 'None published'}</dd>
              </div>
            </dl>
            <p className="field-note">
              {facts.eligibility.length > 0
                ? `The form also asks: ${facts.eligibility.join('; ').toLowerCase()}.`
                : 'The form confirms your eligibility details before submission.'}
            </p>
          </fieldset>

          <div className="panel-actions">
            <Link className="button orange" href={facts.applyHref} onClick={close}>
              Start application <ArrowIcon />
            </Link>
            <Link className="text-link" href="/my-applications" onClick={close}>
              Continue an application <ArrowIcon />
            </Link>
          </div>
        </div>
      </dialog>
    </PanelContext.Provider>
  );
}
