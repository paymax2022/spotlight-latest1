'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { authHeaders } from '@/src/lib/auth/client';
import { ArrowIcon } from '@/components/season2/Icons';
import { programmeTitle } from './programmeNames';

interface ApplicationRow {
  id: string;
  programName?: string;
  programType?: string;
  reference?: string;
  status?: string;
  nextAction?: string;
  detailsHref?: string;
  editHref?: string;
  submittedAt?: string;
}

type View = 'loading' | 'ready' | 'error' | 'auth';

const STATUS_LABELS: Record<string, { label: string; tone: 'draft' | 'go' | 'stop' | 'none' }> = {
  draft: { label: 'Draft · in progress', tone: 'draft' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'draft' },
  submitted: { label: 'Submitted', tone: 'none' },
  under_review: { label: 'In review', tone: 'none' },
  review: { label: 'In review', tone: 'none' },
  shortlisted: { label: 'Shortlisted', tone: 'go' },
  accepted: { label: 'Accepted', tone: 'go' },
  approved: { label: 'Accepted', tone: 'go' },
  selected: { label: 'Selected', tone: 'go' },
  rejected: { label: 'Not selected', tone: 'stop' },
  declined: { label: 'Not selected', tone: 'stop' },
  withdrawn: { label: 'Withdrawn', tone: 'stop' },
};

function statusMeta(status?: string) {
  const key = String(status || '').toLowerCase();
  return STATUS_LABELS[key] ?? {
    label: key ? key.replaceAll('_', ' ') : 'Received',
    tone: 'none' as const,
  };
}

function formatDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="form-kicker">{children}</p>;
}

export default function MyApplicationsClient() {
  const [items, setItems] = useState<ApplicationRow[]>([]);
  const [view, setView] = useState<View>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setView('loading');
      setError('');
      try {
        const res = await fetch('/api/me/applications', {
          headers: await authHeaders(),
          cache: 'no-store',
        });
        const payload = await res.json().catch(() => ({}));
        if (res.status === 401) {
          if (!cancelled) setView('auth');
          return;
        }
        if (!res.ok) throw new Error(payload?.error || 'Unable to load applications.');
        if (!cancelled) {
          setItems(Array.isArray(payload?.applications) ? payload.applications : []);
          setView('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load applications.');
          setView('error');
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (view === 'loading') {
    return (
      <div aria-busy="true">
        <div className="ledger-head">
          <h2 className="ledger-title">Your applications</h2>
          <span className="ledger-count">Loading the ledger</span>
        </div>
        <div className="ledger">
          {[0, 1, 2].map((row) => (
            <div className="ledger-skeleton" key={row}>
              <div className="skeleton" style={{ height: 26 }} />
              <div>
                <div className="skeleton" style={{ width: '46%' }} />
                <div className="skeleton" style={{ width: '68%', marginTop: 10 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (view === 'auth') {
    return (
      <div className="ledger-empty">
        <Kicker>SESSION NEEDED</Kicker>
        <h3>Sign in to see your applications.</h3>
        <p>Your draft is attached to your account. Sign in with the same email to pick it up.</p>
        <div className="actions">
          <Link
            className="button orange"
            href={`/login?next=${encodeURIComponent('/my-applications')}`}
          >
            Sign in <ArrowIcon />
          </Link>
        </div>
      </div>
    );
  }

  if (view === 'error') {
    return (
      <div className="ledger-error" role="alert">
        <Kicker>COULD NOT LOAD</Kicker>
        <h3>Try that again.</h3>
        <p>{error}</p>
        <div className="actions">
          <button type="button" className="button orange" onClick={() => setAttempt((n) => n + 1)}>
            Retry <ArrowIcon />
          </button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="ledger-empty">
        <Kicker>
          <span>00</span> NO APPLICATIONS FILED
        </Kicker>
        <h3>Nothing filed yet.</h3>
        <p>When you start an application it appears here, saved after every step.</p>
        <div className="actions">
          <Link className="button orange" href="/apply/reality-tv-show">
            Start your application <ArrowIcon />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="ledger-head">
        <h2 className="ledger-title">Your applications</h2>
        <span className="ledger-count">{items.length} on file</span>
      </div>
      <div className="ledger">
        {items.map((item, index) => {
          const meta = statusMeta(item.status);
          const when = formatDate(item.submittedAt);
          const href = item.editHref || item.detailsHref || '/my-applications';
          const action = item.nextAction || (item.status === 'draft' ? 'Continue' : 'View');

          return (
            <article className="ledger-row" key={String(item.id)}>
              <span className="ledger-index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h3 className="ledger-name">{programmeTitle(item.programName)}</h3>
                <p className="ledger-meta">
                  {item.programType ? <span>{item.programType}</span> : null}
                  {item.reference ? <span>Ref {item.reference}</span> : null}
                  {when ? <span>Updated {when}</span> : null}
                </p>
                <span className="ledger-status" data-tone={meta.tone}>
                  {meta.label}
                </span>
              </div>
              <Link className="text-link ledger-action" href={href}>
                {action} <ArrowIcon />
              </Link>
            </article>
          );
        })}
      </div>
    </div>
  );
}
