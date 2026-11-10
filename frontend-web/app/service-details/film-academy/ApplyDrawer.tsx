'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import ApplyForm from './ApplyForm';
import styles from './apply.module.css';

const APPLY_PATH = '/service-details/film-academy';

/** The deep link every apply entry point uses, whether or not JS has run. */
export function applyHref(batch?: string): string {
  return `${APPLY_PATH}?apply=1${batch ? `&batch=${encodeURIComponent(batch)}` : ''}`;
}

type ApplyContextValue = { openApply: (batch?: string) => void };
const ApplyContext = createContext<ApplyContextValue | null>(null);

function useApplyContext(): ApplyContextValue {
  const value = useContext(ApplyContext);
  if (!value) throw new Error('Academy apply links must live inside AcademyApplyProvider.');
  return value;
}

/**
 * An apply entry point. It stays a real anchor to the deep link so it works
 * without JS, opens in a new tab on cmd/ctrl-click, and is crawlable — a plain
 * click is intercepted and opens the drawer instead of navigating.
 */
export function ApplyLink({
  batch,
  className,
  children,
}: {
  batch?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { openApply } = useApplyContext();
  return (
    <Link
      href={applyHref(batch)}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        openApply(batch);
      }}
    >
      {children}
    </Link>
  );
}

function readLocation() {
  const params = new URLSearchParams(window.location.search);
  return { on: params.get('apply') === '1', batch: params.get('batch') ?? '' };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Owns the admissions drawer: the URL it is addressed by, the scroll lock and
 * focus trap while it is open, and the panel itself. The form is only mounted
 * while the drawer is on screen, so the catalogue is fetched on open and never
 * on a plain visit to the page.
 */
export default function AcademyApplyProvider({
  fontClassName,
  children,
}: {
  fontClassName: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [batch, setBatch] = useState('');
  const [host, setHost] = useState<HTMLElement | null>(null);
  const pushed = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => setHost(document.body), []);

  // The URL is the source of truth: a deep link opens the drawer on arrival,
  // and Back closes it rather than leaving the page.
  useEffect(() => {
    const initial = readLocation();
    if (initial.on) {
      setBatch(initial.batch);
      setOpen(true);
    }
    const onPop = () => {
      const next = readLocation();
      setBatch(next.batch);
      setOpen(next.on);
      if (!next.on) pushed.current = 0;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openApply = useCallback((nextBatch?: string) => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const url = new URL(window.location.href);
    url.searchParams.set('apply', '1');
    if (nextBatch) url.searchParams.set('batch', nextBatch);
    else url.searchParams.delete('batch');
    window.history.pushState(window.history.state, '', url);
    pushed.current += 1;
    setBatch(nextBatch ?? '');
    setOpen(true);
  }, []);

  const closeApply = useCallback(() => {
    setOpen(false);
    if (pushed.current > 0) {
      pushed.current -= 1;
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('apply');
    url.searchParams.delete('batch');
    window.history.replaceState(window.history.state, '', url);
  }, []);

  // Keep the panel mounted through the exit transition, then drop the form so
  // a reopen always reads a fresh catalogue.
  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    if (!rendered) return;
    const timer = window.setTimeout(() => setRendered(false), 480);
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  useEffect(() => {
    if (!open) return;
    const { overflow, paddingRight } = document.body.style;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !rendered) return;
    const panel = panelRef.current;
    if (!panel) return;

    const timer = window.setTimeout(() => {
      panel.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }, 80);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeApply();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((node) => node.offsetParent !== null || node === document.activeElement);
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, rendered, closeApply]);

  // Hand focus back to whatever opened the drawer once it has slid away.
  useEffect(() => {
    if (open || !restoreFocus.current) return;
    const target = restoreFocus.current;
    restoreFocus.current = null;
    const timer = window.setTimeout(() => {
      if (document.contains(target)) target.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  const value = { openApply };

  return (
    <ApplyContext.Provider value={value}>
      {children}
      {host && createPortal(
        <div
          className={`${styles.root} ${fontClassName}`}
          data-state={open ? 'open' : 'closed'}
          aria-hidden={!open}
        >
          <button
            type="button"
            className={styles.scrim}
            tabIndex={-1}
            aria-label="Close the application"
            onClick={closeApply}
          />
          <div
            ref={panelRef}
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="academy-apply-title"
            tabIndex={-1}
          >
            <span className={styles.perforation} aria-hidden="true" />
            <div className={styles.clapper} aria-hidden="true" />

            <header className={styles.head}>
              <div className={styles.headCopy}>
                <span className={styles.eyebrow}>
                  <span className={styles.dot} aria-hidden="true" />
                  <span>Spotlight Film Academy</span>
                  <span className={styles.eyebrowTail}>
                    <span aria-hidden="true">·</span>
                    <span>Lekki, Lagos</span>
                  </span>
                </span>
                <h2 className={styles.title} id="academy-apply-title">
                  Apply for <em>admission</em>
                </h2>
                <p className={styles.subtitle}>
                  Choose an intake, pick the crafts you want to train in, and see exactly what is charged today.
                </p>
              </div>
              <button
                type="button"
                className={styles.close}
                onClick={closeApply}
                aria-label="Close the application"
                data-autofocus
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M2.5 2.5 13.5 13.5M13.5 2.5 2.5 13.5" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className={styles.body}>
              {rendered && <ApplyForm prefillBatch={batch} onClose={closeApply} />}
            </div>
          </div>
        </div>,
        host,
      )}
    </ApplyContext.Provider>
  );
}