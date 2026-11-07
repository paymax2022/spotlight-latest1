'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { authHeaders } from '@/src/lib/auth/client';
import { ArrowIcon } from '@/components/season2/Icons';
import { programmeTitle } from './programmeNames';

type Profile = Record<string, any>;
type Completion = { percentage: number; missingRequired: string[] };

type Opportunity = {
  id: string;
  slug: string;
  title: string;
  programType: string;
  shortDescription: string;
  deadline?: string;
  location?: string;
  deliveryMode: string;
  applicationFee: number;
  prizeOrBenefit?: string;
  eligibility?: string;
  status: string;
  applyHref: string;
  detailsHref: string;
  source: string;
};

type Application = {
  id: string;
  programId: string;
  programName: string;
  programType: string;
  reference?: string;
  submittedAt?: string;
  deadline?: string;
  status: string;
  nextAction: string;
  detailsHref: string;
  editHref?: string;
  source: string;
};

type Summary = Record<string, number>;

export type Tab = 'contests' | 'applications' | 'overview';
type Tone = 'draft' | 'warn' | 'go' | 'stop' | 'none';
type Status = { label: string; tone: Tone };

const STATUSES: Record<string, Status> = {
  draft: { label: 'Draft', tone: 'draft' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'draft' },
  submitted: { label: 'Submitted', tone: 'none' },
  under_review: { label: 'In review', tone: 'none' },
  shortlisted: { label: 'Shortlisted', tone: 'go' },
  approved: { label: 'Approved', tone: 'go' },
  accepted: { label: 'Accepted', tone: 'go' },
  rejected: { label: 'Not selected', tone: 'stop' },
  withdrawn: { label: 'Withdrawn', tone: 'stop' },
  correction_requested: { label: 'Corrections asked', tone: 'warn' },
};

const FILTER_STATUS_KEYS = [
  'draft',
  'submitted',
  'under_review',
  'shortlisted',
  'approved',
  'rejected',
  'correction_requested',
];

function statusKey(raw?: string) {
  return String(raw || '').toLowerCase().replace(/\s+/g, '_');
}

function statusMeta(raw?: string): Status {
  return STATUSES[statusKey(raw)] ?? {
    label: statusKey(raw).replace(/_/g, ' ') || 'Filed',
    tone: 'none',
  };
}

function statusLabel(raw: string) {
  return raw.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysUntil(iso?: string) {
  if (!iso) return null;
  const diff = Date.parse(iso) - Date.now();
  if (Number.isNaN(diff)) return null;
  return Math.ceil(diff / 86_400_000);
}

function dayCount(days: number) {
  return `${days} day${days === 1 ? '' : 's'} left`;
}

function feeLabel(fee: number) {
  if (!fee || fee === 0) return 'Free entry';
  return `₦${fee.toLocaleString()}`;
}

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}

function monthShort(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-NG', { month: 'short' }).toUpperCase();
}

function dayOfMonth(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return String(date.getDate()).padStart(2, '0');
}

/** completion.missingRequired arrives as field keys; the page shows labels. */
function fieldLabel(field: string) {
  const words = field
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const QUICK_LINKS = [
  { href: '/utility', title: 'Pay Bills', description: 'Airtime, data, electricity and TV, straight from your wallet.' },
  { href: '/restaurant', title: 'Order Food', description: 'Restaurants near you, delivered to your door.' },
  { href: '/crowdfunding', title: 'Fund a Cause', description: 'Back a campaign or start one of your own.' },
  { href: '/open-mic', title: 'Open Mic Voting', description: 'Back your favourites and follow the live tallies.' },
  { href: '/film-academy/dashboard', title: 'Film Academy', description: 'Enrolment, courses and tuition in one place.' },
  { href: '/stem/contests', title: 'STEM Contests', description: 'Competitions for schools, teams and students.' },
  { href: '/earn', title: 'Refer and Earn', description: 'Invite friends to Spotlight, get rewarded.' },
  { href: '/profile', title: 'My Profile', description: 'Personal details and verification status.' },
];

type BoardItem = {
  key: string;
  name: string;
  why: string;
  href: string;
  cta: string;
  urgent: boolean;
};

function Kicker({ children }: { children: ReactNode }) {
  return <p className="hub-eyebrow">{children}</p>;
}

function ContestCard({ item, userApp }: { item: Opportunity; userApp?: Application }) {
  const days = daysUntil(item.deadline);
  const applied = !!userApp;
  const isOpenMic = item.programType.toLowerCase().includes('open mic');
  const status = applied ? statusMeta(userApp!.status) : null;
  const isDraft = statusKey(userApp?.status).includes('draft');

  return (
    <article className={`hub-call${applied ? ' is-applied' : ''}`}>
      <div className="hub-call-top">
        <p className="hub-call-type">{item.programType}</p>
        {status ? (
          <span className="hub-tag" data-tone={status.tone}>
            {status.label}
          </span>
        ) : null}
      </div>

      <h3>{item.title}</h3>
      <p className="hub-call-copy">{item.shortDescription}</p>
      {item.prizeOrBenefit ? <p className="hub-call-prize">{item.prizeOrBenefit}</p> : null}

      <p className="hub-call-meta">
        {item.location ? <span className="is-loc">{item.location}</span> : null}
        {item.deliveryMode ? <span>{item.deliveryMode}</span> : null}
        <span className={item.applicationFee ? 'is-fee' : 'is-free'}>
          {feeLabel(item.applicationFee)}
        </span>
        {days !== null ? <span>{days > 0 ? dayCount(days) : days === 0 ? 'Closes today' : 'Closed'}</span> : null}
      </p>

      <div className="hub-call-actions">
        {!applied ? (
          <Link className="button orange" href={item.applyHref}>
            Apply now <ArrowIcon />
          </Link>
        ) : isDraft && userApp?.editHref ? (
          <Link className="button orange" href={userApp.editHref}>
            Continue <ArrowIcon />
          </Link>
        ) : isOpenMic ? (
          <Link className="button dark" href={`/open-mic/${item.slug}/entries`}>
            Vote now <ArrowIcon />
          </Link>
        ) : (
          <Link className="button dark" href={userApp!.detailsHref}>
            Track status <ArrowIcon />
          </Link>
        )}
        <Link className="text-link" href={item.detailsHref}>
          Details <ArrowIcon />
        </Link>
      </div>
    </article>
  );
}

function ShareButton({ url, label }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  function handleShare() {
    const fullUrl = `${window.location.origin}${url}`;
    if (navigator.share) {
      void navigator.share({ title: label || 'Spotlight Open Mic', url: fullUrl });
      return;
    }
    void navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button type="button" className="hub-share" onClick={handleShare}>
      {copied ? 'Link copied' : 'Share'}
    </button>
  );
}

function LedgerRow({
  item,
  index,
}: {
  item: Application;
  index: number;
}) {
  const status = statusMeta(item.status);
  const filed = formatDate(item.submittedAt);
  const isOpenMic = item.source.startsWith('open_mic');
  const voteHref = `/open-mic/${item.programName}/entries`;
  // A draft's next step is the editor, so the details link must not repeat the
  // server's own instruction ("Continue application") next to Continue.
  const detailsLabel = item.editHref ? 'View' : item.nextAction || 'View';

  return (
    <article className="hub-ledger-row">
      <span className="hub-ledger-no" aria-hidden="true">
        {String(index + 1).padStart(2, '0')}
      </span>
      <div>
        <h3 className="hub-ledger-name">{programmeTitle(item.programName)}</h3>
        <p className="hub-ledger-meta">
          {item.programType ? <span>{item.programType}</span> : null}
          {item.reference ? <span>Ref {item.reference}</span> : null}
          {filed ? <span>Filed {filed}</span> : null}
        </p>
        <span className="hub-tag" data-tone={status.tone}>
          {status.label}
        </span>
      </div>
      <div className="hub-ledger-actions">
        {item.editHref ? (
          <Link className="text-link" href={item.editHref}>
            Continue <ArrowIcon />
          </Link>
        ) : null}
        {isOpenMic ? (
          <>
            <Link className="text-link" href={voteHref}>
              Vote <ArrowIcon />
            </Link>
            <ShareButton url={voteHref} label={item.programName} />
          </>
        ) : (
          <Link className="text-link" href={item.detailsHref}>
            {detailsLabel} <ArrowIcon />
          </Link>
        )}
      </div>
    </article>
  );
}

function DueRow({ item, userApp }: { item: Opportunity; userApp?: Application }) {
  const days = daysUntil(item.deadline) ?? 0;
  const level = days <= 2 ? 'now' : days <= 7 ? 'soon' : 'none';
  const status = userApp ? statusMeta(userApp.status) : null;

  return (
    <div className="hub-due-row">
      <p className="hub-due-when">
        <b>{dayOfMonth(item.deadline)}</b>
        <small>{monthShort(item.deadline)}</small>
      </p>
      <div>
        <p className="hub-due-name">{item.title}</p>
        <p className="hub-due-type">{item.programType}</p>
      </div>
      {status ? (
        <span className="hub-tag" data-tone={status.tone}>
          {status.label}
        </span>
      ) : (
        <span className="hub-countdown" data-level={level}>
          {days === 0 ? 'Today' : dayCount(days)}
        </span>
      )}
    </div>
  );
}

export default function UserDashboardClient({ initialTab }: { initialTab: Tab }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [summary, setSummary] = useState<Summary>({});
  const [view, setView] = useState<'loading' | 'ready' | 'error' | 'auth'>('loading');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showApplied, setShowApplied] = useState(false);

  // The site menu's "My applications" entry arrives as ?tab=applications. Clicking
  // it while already here re-renders with a new initialTab without remounting, so
  // the link wins over local state during render rather than through an effect.
  const [linkedTab, setLinkedTab] = useState(initialTab);
  if (linkedTab !== initialTab) {
    setLinkedTab(initialTab);
    setActiveTab(initialTab);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setView('loading');
      setMessage('');
      try {
        const headers = await authHeaders();
        const [meRes, appsRes, oppRes] = await Promise.all([
          fetch('/api/me', { headers, cache: 'no-store' }),
          fetch('/api/me/applications', { headers, cache: 'no-store' }),
          fetch('/api/opportunities', { cache: 'no-store' }),
        ]);

        if (meRes.status === 401) {
          if (!cancelled) setView('auth');
          return;
        }

        const [me, apps, opps] = await Promise.all([
          meRes.json().catch(() => ({})),
          appsRes.json().catch(() => ({})),
          oppRes.json().catch(() => ({})),
        ]);

        if (!meRes.ok) {
          if (!cancelled) setView('auth');
          return;
        }

        const partial: string[] = [];
        if (!appsRes.ok) partial.push('Some applications could not be loaded.');
        if (!oppRes.ok) partial.push('Opportunities could not be loaded.');
        if (!cancelled) setMessage(partial.join(' '));

        if (!cancelled) {
          setProfile(me.profile ?? null);
          setCompletion(me.completion ?? null);
          setApplications(Array.isArray(apps.applications) ? apps.applications : []);
          setSummary(apps.summary ?? {});
          setOpportunities(Array.isArray(opps.opportunities) ? opps.opportunities : []);
          setView('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setMessage(e instanceof Error ? e.message : 'Unable to load your dashboard.');
          setView('error');
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const appFor = useMemo(() => {
    const byProgram: Record<string, Application> = {};
    for (const item of applications) byProgram[item.programId] = item;
    return (opportunity: Opportunity) =>
      byProgram[opportunity.id] || byProgram[opportunity.slug];
  }, [applications]);

  const contestTypes = useMemo(
    () => Array.from(new Set(opportunities.map((o) => o.programType))).sort(),
    [opportunities],
  );

  const filteredContests = useMemo(() => {
    const q = search.toLowerCase();
    return opportunities.filter((o) => {
      if (q && !`${o.title} ${o.programType} ${o.location || ''}`.toLowerCase().includes(q))
        return false;
      if (typeFilter && o.programType !== typeFilter) return false;
      if (showApplied && !appFor(o)) return false;
      return true;
    });
  }, [opportunities, search, typeFilter, showApplied, appFor]);

  const filteredApps = useMemo(() => {
    const q = search.toLowerCase();
    return applications.filter((a) => {
      if (statusFilter && statusKey(a.status) !== statusFilter) return false;
      if (
        q &&
        !`${a.programName} ${a.programType} ${a.reference || ''}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [applications, search, statusFilter]);

  const needsAction = useMemo<BoardItem[]>(() => {
    const items: BoardItem[] = [];
    for (const a of applications) {
      const key = statusKey(a.status);
      if (key.includes('correction')) {
        items.push({
          key: a.id,
          name: programmeTitle(a.programName),
          why: 'Reviewers asked for changes to your file.',
          href: a.detailsHref,
          cta: 'Respond',
          urgent: true,
        });
      } else if (key.includes('draft') && a.editHref) {
        items.push({
          key: a.id,
          name: programmeTitle(a.programName),
          why: 'Draft — every finished step is already saved.',
          href: a.editHref,
          cta: 'Continue',
          urgent: false,
        });
      }
    }
    for (const o of opportunities) {
      const days = daysUntil(o.deadline);
      if (days === null || days < 0 || days > 7 || appFor(o)) continue;
      items.push({
        key: o.id,
        name: o.title,
        why:
          days === 0
            ? 'Entries close today.'
            : `Entries close in ${days} day${days === 1 ? '' : 's'}.`,
        href: o.applyHref,
        cta: 'Apply now',
        urgent: days <= 3,
      });
    }
    return items.sort((a, b) => Number(b.urgent) - Number(a.urgent)).slice(0, 6);
  }, [applications, opportunities, appFor]);

  const closingSoon = useMemo(
    () =>
      opportunities
        .filter((o) => {
          const d = daysUntil(o.deadline);
          return d !== null && d >= 0 && d <= 14;
        })
        .sort((a, b) => Date.parse(String(a.deadline)) - Date.parse(String(b.deadline)))
        .slice(0, 6),
    [opportunities],
  );

  if (view === 'auth') {
    return (
      <section className="hub-desk" aria-label="Sign in">
        <div className="wrap hub-solo">
          <div className="hub-state">
            <Kicker>
              <span>00</span> SESSION NEEDED
            </Kicker>
            <h3>Sign in to your desk.</h3>
            <p>
              Browse active contests, track your applications and manage your Spotlight profile.
              Your drafts are attached to your account, so picking up where you left off takes one
              sign in.
            </p>
            <Link className="button orange" href="/login?next=/user-dashboard">
              Sign in <ArrowIcon />
            </Link>
            <Link className="text-link" href="/login?tab=signup&next=/user-dashboard">
              Create an account free <ArrowIcon />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (view === 'error') {
    return (
      <section className="hub-desk" aria-label="Could not load">
        <div className="wrap hub-solo">
          <div className="hub-state is-alert" role="alert">
            <Kicker>
              <span>00</span> COULD NOT LOAD
            </Kicker>
            <h3>Try that again.</h3>
            <p>{message}</p>
            <button
              type="button"
              className="button orange"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry <ArrowIcon />
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (view === 'loading') {
    return (
      <section className="hub-desk" aria-label="Loading your dashboard">
        <div className="wrap hub-skeleton" aria-busy="true">
          <div className="skeleton" style={{ height: 54, width: '58%' }} />
          <div className="skeleton" style={{ height: 16, width: '34%' }} />
          <div className="skeleton" style={{ height: 120, width: '100%' }} />
          <div className="skeleton" style={{ height: 16, width: '72%' }} />
          <div className="skeleton" style={{ height: 16, width: '64%' }} />
        </div>
      </section>
    );
  }

  const rawName =
    profile?.firstName ||
    profile?.displayName ||
    (profile?.raw?.full_name as string | undefined) ||
    (profile?.email ? String(profile.email).split('@')[0].replace(/[._-]+/g, ' ') : undefined);
  const firstName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : 'there';

  const completionPct = Math.min(100, Math.max(0, Number(completion?.percentage || 0)));
  const missing = Array.isArray(completion?.missingRequired) ? completion.missingRequired : [];
  const filledCells = Math.round(completionPct / 10);

  const tabs: [Tab, string][] = [
    ['contests', `Contests (${opportunities.length})`],
    ['applications', `My Applications (${applications.length})`],
    ['overview', 'Overview'],
  ];

  function pickTab(tab: Tab) {
    setActiveTab(tab);
    setSearch('');
    setTypeFilter('');
    setStatusFilter('');
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url);
  }

  return (
    <>
      <section className="hub-desk" aria-labelledby="desk-title">
        <div className="wrap hub-desk-inner">
          <div>
            <p className="eyebrow">
              <i></i> MEMBER DESK <b></b> YOUR FILE
            </p>
            <h2 className="hub-hello" id="desk-title">
              Welcome back, <em>{firstName}</em>.
            </h2>
            <p className="hub-line">
              {opportunities.length} active contest{opportunities.length === 1 ? '' : 's'} open
              {applications.length > 0
                ? ` · ${applications.length} application${applications.length === 1 ? '' : 's'} on file`
                : ''}
            </p>
          </div>

          <div className="hub-meter">
            <p className="hub-meter-head">
              Profile completion <span>{completionPct}%</span>
            </p>
            <div className="hub-meter-cells" aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} className={i < filledCells ? 'is-on' : undefined} />
              ))}
            </div>
            {missing.length > 0 ? (
              <p className="hub-meter-foot">
                {missing.slice(0, 4).map((field) => (
                  <span className="hub-chip" key={field}>
                    {fieldLabel(field)}
                  </span>
                ))}
                {missing.length > 4 ? <span>+{missing.length - 4} more</span> : null}
              </p>
            ) : (
              <p className="hub-meter-foot">Your file is complete — nothing outstanding.</p>
            )}
            <Link className="button light" href="/profile">
              {completionPct >= 80 ? 'Edit profile' : `Finish profile (${completionPct}%)`}{' '}
              <ArrowIcon />
            </Link>
          </div>
        </div>
      </section>

      <section aria-label="Your account at a glance">
        <dl className="hub-stats wrap">
          <div>
            <dt>Open calls</dt>
            <dd>{opportunities.length}</dd>
          </div>
          <div>
            <dt>Applied</dt>
            <dd>{summary.total || 0}</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{summary.submitted || 0}</dd>
          </div>
          <div>
            {/* The board below is the same count, so the tile has to agree with it:
                summary.pendingCorrections alone would read 0 next to a live draft. */}
            <dt>Needs action</dt>
            <dd className={needsAction.length > 0 ? 'is-accent' : undefined}>
              {needsAction.length}
            </dd>
          </div>
        </dl>
      </section>

      <section className="hub-sheet" aria-label="Your dashboard">
        <div className="wrap">
          {message ? (
            <div className="hub-banner" role="status">
              <span>{message}</span>
              <button type="button" onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </button>
            </div>
          ) : null}

          {needsAction.length > 0 || closingSoon.length > 0 ? (
            <div className="hub-board">
              {needsAction.length > 0 ? (
                <div>
                  <div className="hub-board-head">
                    <div>
                      <Kicker>
                        <span>01</span> NEEDS YOU
                      </Kicker>
                      <h2 className="hub-h2">
                        Do these <em>first.</em>
                      </h2>
                    </div>
                  </div>
                  <div className="hub-do">
                    {needsAction.map((item, index) => (
                      <div
                        className={`hub-do-row${item.urgent ? ' is-urgent' : ''}`}
                        key={item.key}
                      >
                        <span className="hub-do-no" aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div>
                          <p className="hub-do-name">{item.name}</p>
                          <p className="hub-do-why">{item.why}</p>
                        </div>
                        <Link className="text-link" href={item.href}>
                          {item.cta} <ArrowIcon />
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {closingSoon.length > 0 ? (
                <div>
                  <div className="hub-board-head">
                    <div>
                      <Kicker>
                        <span>02</span> CLOSING SOON
                      </Kicker>
                      <h2 className="hub-h2">
                        Next <em>fortnight.</em>
                      </h2>
                    </div>
                  </div>
                  <div className="hub-do">
                    {closingSoon.map((item) => (
                      <DueRow key={item.id} item={item} userApp={appFor(item)} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="hub-tabs" role="group" aria-label="Dashboard views">
            {tabs.map(([tab, label]) => (
              <button
                type="button"
                key={tab}
                className="hub-tab"
                aria-pressed={activeTab === tab}
                onClick={() => pickTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'contests' ? (
            <section aria-label="Open calls">
              <div className="hub-filters">
                <label className="hub-field">
                  Search
                  <input
                    type="text"
                    placeholder="Title, type or place"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label className="hub-field">
                  Programme type
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="">All types</option>
                    {contestTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="hub-check">
                  <input
                    type="checkbox"
                    checked={showApplied}
                    onChange={(e) => setShowApplied(e.target.checked)}
                  />
                  Applied only
                </label>
              </div>

              {filteredContests.length === 0 ? (
                <div className="hub-state">
                  <Kicker>
                    <span>00</span> NOTHING MATCHES
                  </Kicker>
                  <h3>{search || typeFilter || showApplied ? 'No calls match.' : 'No open calls.'}</h3>
                  <p>
                    {search || typeFilter || showApplied
                      ? 'Widen the filters to see more of the schedule.'
                      : 'Nothing is taking entries right now. Check back soon.'}
                  </p>
                </div>
              ) : (
                <div className="hub-calls">
                  {filteredContests.map((item) => (
                    <ContestCard key={item.id} item={item} userApp={appFor(item)} />
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeTab === 'applications' ? (
            <section aria-label="Your applications">
              <div className="hub-filters">
                <label className="hub-field">
                  Search
                  <input
                    type="text"
                    placeholder="Programme or reference"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label className="hub-field">
                  Status
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All statuses</option>
                    {FILTER_STATUS_KEYS.map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {filteredApps.length === 0 ? (
                <div className="hub-state">
                  <Kicker>
                    <span>{String(applications.length).padStart(2, '0')}</span> NO FILINGS
                  </Kicker>
                  <h3>Nothing filed yet.</h3>
                  {applications.length === 0 ? (
                    <p>
                      You haven&apos;t applied to any contests yet.{' '}
                      <button
                        type="button"
                        className="hub-link"
                        onClick={() => pickTab('contests')}
                      >
                        Browse open calls
                      </button>
                    </p>
                  ) : (
                    <p>No application matches this filter.</p>
                  )}
                </div>
              ) : (
                <div className="hub-ledger">
                  {filteredApps.map((item, index) => (
                    <LedgerRow key={item.id} item={item} index={index} />
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeTab === 'overview' ? (
            <section aria-label="Overview">
              <div className="hub-split">
                <div>
                  <Kicker>
                    <span>03</span> STATUS BREAKDOWN
                  </Kicker>
                  <h2 className="hub-h2">
                    Where things <em>stand.</em>
                  </h2>
                  <dl className="hub-tally">
                    {FILTER_STATUS_KEYS.map((key) => {
                      const count = applications.filter((a) => statusKey(a.status) === key).length;
                      if (!count) return null;
                      return (
                        <div key={key}>
                          <dt>{statusMeta(key).label}</dt>
                          <dd>{count}</dd>
                        </div>
                      );
                    })}
                    {applications.length === 0 ? (
                      <div>
                        <dt>Filed applications</dt>
                        <dd>0</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>

                <div>
                  <Kicker>
                    <span>04</span> RECENT FILINGS
                  </Kicker>
                  <h2 className="hub-h2">
                    Last <em>five.</em>
                  </h2>
                  {applications.length === 0 ? (
                    <p className="hub-note">
                      Filings appear here the moment you start one, saved after every step.
                    </p>
                  ) : (
                    <div className="hub-ledger">
                      {applications.slice(0, 5).map((item, index) => (
                        <LedgerRow key={item.id} item={item} index={index} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </section>

      <section className="hub-access" aria-label="Spotlight services">
        <div className="wrap">
          <Kicker>
            <span>08</span> EVERY SERVICE
          </Kicker>
          <h2 className="hub-h2">
            The rest of <em>Spotlight.</em>
          </h2>
          <div className="hub-access-grid">
            {QUICK_LINKS.map((item, index) => (
              <Link className="hub-access-cell" href={item.href} key={item.href}>
                <i aria-hidden="true">{String(index + 1).padStart(2, '0')}</i>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
