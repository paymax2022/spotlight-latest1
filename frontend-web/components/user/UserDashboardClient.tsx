'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { authHeaders } from '@/src/lib/auth/client';

// ─── Types ───────────────────────────────────────────────────────────────────

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

type Tab = 'contests' | 'applications' | 'overview';

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  draft:        'background:#e5e7eb;color:#374151',
  submitted:    'background:#dbeafe;color:#1d4ed8',
  under_review: 'background:#fef3c7;color:#92400e',
  approved:     'background:#d1fae5;color:#065f46',
  rejected:     'background:#fee2e2;color:#991b1b',
  shortlisted:  'background:#ede9fe;color:#5b21b6',
  correction_requested: 'background:#ffedd5;color:#9a3412',
};

function statusStyle(raw: string) {
  const key = raw.toLowerCase().replace(/\s+/g, '_');
  return STATUS_COLOR[key] || STATUS_COLOR.submitted;
}

function statusLabel(raw: string) {
  return raw.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysUntil(iso?: string) {
  if (!iso) return null;
  const diff = Date.parse(iso) - Date.now();
  const days = Math.ceil(diff / 86_400_000);
  return days;
}

function feeLabel(fee: number) {
  if (!fee || fee === 0) return 'Free';
  return `₦${fee.toLocaleString()}`;
}

const TYPE_ICON: Record<string, string> = {
  'open mic contest':  '🎤',
  'stem contest':      '🔬',
  'sme pitch':         '💼',
  'football':          '⚽',
  'acting':            '🎭',
  'film':              '🎬',
  'beauty':            '💄',
  'dance':             '💃',
  'comedy':            '😂',
};

function programIcon(type: string) {
  const t = type.toLowerCase();
  for (const [key, icon] of Object.entries(TYPE_ICON)) {
    if (t.includes(key)) return icon;
  }
  return '🏆';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ContestCard({
  item,
  userApp,
}: {
  item: Opportunity;
  userApp: Application | undefined;
}) {
  const days = daysUntil(item.deadline);
  const applied = !!userApp;
  const isDraft = userApp?.status?.toLowerCase().includes('draft');
  const isRejected = userApp?.status?.toLowerCase().includes('reject');

  return (
    <div
      style={{
        border: applied ? '1.5px solid #3b82f6' : '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '16px',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        position: 'relative',
      }}
    >
      {/* Applied badge (top-right) */}
      {applied && (
        <span
          style={{
            position: 'absolute', top: 12, right: 12,
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
            ...Object.fromEntries(statusStyle(userApp!.status).split(';').map((s) => s.split(':').map((x) => x.trim()))),
          }}
        >
          {statusLabel(userApp!.status)}
        </span>
      )}

      {/* Header */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>{programIcon(item.programType)}</span>
        <div style={{ flex: 1, minWidth: 0, paddingRight: applied ? 80 : 0 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', color: '#6b7280', marginBottom: 2, fontWeight: 600 }}>
            {item.programType}
          </p>
          <h5 style={{ margin: 0, fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{item.title}</h5>
        </div>
      </div>

      {/* Description */}
      <p style={{ margin: 0, fontSize: 13, color: '#4b5563', lineHeight: 1.5 }}>
        {item.shortDescription}
      </p>

      {/* Meta row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, color: '#6b7280' }}>
        {item.location && (
          <span>📍 {item.location}</span>
        )}
        <span style={{
          fontWeight: 700,
          color: item.applicationFee ? '#92400e' : '#065f46',
        }}>
          {feeLabel(item.applicationFee)}
        </span>
        {days !== null && (
          <span style={{ color: days <= 3 ? '#dc2626' : days <= 7 ? '#d97706' : '#6b7280', fontWeight: days <= 7 ? 700 : 400 }}>
            {days > 0 ? `⏱ ${days}d left` : days === 0 ? '⏱ Closes today' : '⛔ Closed'}
          </span>
        )}
      </div>

      {/* Prize */}
      {item.prizeOrBenefit && (
        <p style={{ margin: 0, fontSize: 12, color: '#7c3aed', fontWeight: 500 }}>
          🎁 {item.prizeOrBenefit}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {!applied && (
          <Link
            href={item.applyHref}
            style={{
              background: '#f59e0b', color: '#000', fontWeight: 700, fontSize: 12,
              padding: '7px 16px', borderRadius: 8, textDecoration: 'none', display: 'inline-block',
            }}
          >
            Apply Now →
          </Link>
        )}
        {applied && isDraft && userApp?.editHref && (
          <Link
            href={userApp.editHref}
            style={{
              background: '#f59e0b', color: '#000', fontWeight: 700, fontSize: 12,
              padding: '7px 16px', borderRadius: 8, textDecoration: 'none',
            }}
          >
            Continue Application →
          </Link>
        )}
        {applied && !isDraft && !isRejected && (
          <Link
            href={userApp!.detailsHref}
            style={{
              background: '#3b82f6', color: '#fff', fontWeight: 700, fontSize: 12,
              padding: '7px 16px', borderRadius: 8, textDecoration: 'none',
            }}
          >
            Track Status →
          </Link>
        )}
        {applied && isRejected && (
          <Link
            href={item.applyHref}
            style={{
              background: 'transparent', border: '1px solid #d1d5db', color: '#6b7280',
              fontSize: 12, padding: '7px 16px', borderRadius: 8, textDecoration: 'none',
            }}
          >
            View Details
          </Link>
        )}
        <Link
          href={item.detailsHref}
          style={{
            background: 'transparent', border: '1px solid #d1d5db', color: '#374151',
            fontSize: 12, padding: '7px 14px', borderRadius: 8, textDecoration: 'none',
          }}
        >
          Details
        </Link>
      </div>
    </div>
  );
}

function ApplicationRow({ item }: { item: Application }) {
  return (
    <div
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        padding: '14px 0', borderBottom: '1px solid #f3f4f6', gap: 12, flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{item.programName}</span>
          <span
            style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              ...Object.fromEntries(statusStyle(item.status).split(';').map((s) => s.split(':').map((x) => x.trim()))),
            }}
          >
            {statusLabel(item.status)}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>
          {item.programType}
          {item.reference ? ` · Ref: ${item.reference}` : ''}
          {item.submittedAt ? ` · ${new Date(item.submittedAt).toLocaleDateString()}` : ''}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {item.editHref && (
          <Link
            href={item.editHref}
            style={{
              background: '#f59e0b', color: '#000', fontWeight: 700, fontSize: 11,
              padding: '6px 12px', borderRadius: 7, textDecoration: 'none',
            }}
          >
            Continue
          </Link>
        )}
        <Link
          href={item.detailsHref}
          style={{
            background: 'transparent', border: '1px solid #d1d5db', color: '#374151',
            fontSize: 11, padding: '6px 12px', borderRadius: 7, textDecoration: 'none',
          }}
        >
          {item.nextAction || 'View'}
        </Link>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function UserDashboardClient() {
  const [profile,      setProfile]      = useState<Profile | null>(null);
  const [completion,   setCompletion]   = useState<Completion | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [summary,      setSummary]      = useState<Summary>({});
  const [authError,    setAuthError]    = useState(false);
  const [dataError,    setDataError]    = useState<string | null>(null);
  const [loading,      setLoading]      = useState(true);

  const [activeTab,    setActiveTab]    = useState<Tab>('contests');
  const [search,       setSearch]       = useState('');
  const [typeFilter,   setTypeFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showApplied,  setShowApplied]  = useState(false);

  async function load() {
    setLoading(true);
    setDataError(null);
    try {
      const headers = await authHeaders();
      const [meRes, appsRes, oppRes] = await Promise.all([
        fetch('/api/me', { headers, cache: 'no-store' }),
        fetch('/api/me/applications', { headers, cache: 'no-store' }),
        fetch('/api/opportunities', { cache: 'no-store' }),
      ]);

      if (meRes.status === 401) { setAuthError(true); return; }

      const [me, apps, opps] = await Promise.all([meRes.json(), appsRes.json(), oppRes.json()]);
      if (!meRes.ok) { setAuthError(true); return; }

      const warns: string[] = [];
      if (!appsRes.ok) warns.push('Some applications could not be loaded.');
      if (!oppRes.ok)  warns.push('Opportunities could not be loaded.');
      if (warns.length) setDataError(warns.join(' '));

      setProfile(me.profile ?? null);
      setCompletion(me.completion ?? null);
      setApplications(apps.applications ?? []);
      setSummary(apps.summary ?? {});
      // Load ALL contests — no artificial cap
      setOpportunities(opps.opportunities ?? []);
    } catch (e) {
      setDataError(e instanceof Error ? e.message : 'Unable to load dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  // Build a quick lookup: contestSlug/id → application
  const appsByProgramId = useMemo(() => {
    const map: Record<string, Application> = {};
    for (const a of applications) {
      map[a.programId] = a;
    }
    return map;
  }, [applications]);

  // Contest type options for filter
  const contestTypes = useMemo(() => {
    const s = new Set(opportunities.map((o) => o.programType));
    return Array.from(s).sort();
  }, [opportunities]);

  // Filtered contest list
  const filteredContests = useMemo(() => {
    const q = search.toLowerCase();
    return opportunities.filter((o) => {
      if (q && !`${o.title} ${o.programType} ${o.location || ''}`.toLowerCase().includes(q)) return false;
      if (typeFilter && o.programType !== typeFilter) return false;
      if (showApplied && !appsByProgramId[o.id] && !appsByProgramId[o.slug]) return false;
      return true;
    });
  }, [opportunities, search, typeFilter, showApplied, appsByProgramId]);

  // Filtered applications list
  const filteredApps = useMemo(() => {
    const q = search.toLowerCase();
    return applications.filter((a) => {
      if (statusFilter && !a.status.toLowerCase().includes(statusFilter.toLowerCase())) return false;
      if (q && !`${a.programName} ${a.programType} ${a.reference || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [applications, search, statusFilter]);

  // ── Not signed in ─────────────────────────────────────────────────────────
  if (!loading && authError) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
        <h3 style={{ marginBottom: 8 }}>Sign in to view your dashboard</h3>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>
          Browse active contests, track your applications, and manage your Spotlight profile.
        </p>
        <Link href="/login?next=/user-dashboard" className="theme-btn">Sign In</Link>
        <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 16 }}>
          No account?{' '}
          <Link href="/login?tab=signup&next=/user-dashboard" style={{ textDecoration: 'underline' }}>Create one free</Link>
        </p>
      </div>
    );
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[100, 60, 300, 200].map((h, i) => (
          <div key={i} style={{ height: h, background: 'rgba(0,0,0,0.06)', borderRadius: 10, animation: 'pulse 1.5s infinite' }} />
        ))}
      </div>
    );
  }

  // ── Name resolution ────────────────────────────────────────────────────────
  const rawName =
    profile?.firstName ||
    profile?.displayName ||
    (profile?.raw?.full_name as string | undefined) ||
    (profile?.email ? (profile.email as string).split('@')[0].replace(/[._-]+/g, ' ') : undefined);
  const firstName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : 'there';

  const completionPct = Number(completion?.percentage || 0);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Warning banner */}
      {dataError && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⚠️ {dataError}</span>
          <button onClick={load} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 12, color: 'inherit' }}>Retry</button>
        </div>
      )}

      {/* Welcome bar */}
      <div className="glass-card rounded-md" style={{ padding: '20px 20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Welcome back, {firstName} 👋</h2>
            <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
              {opportunities.length} active contest{opportunities.length !== 1 ? 's' : ''} open
              {applications.length > 0 ? ` · ${applications.length} application${applications.length !== 1 ? 's' : ''}` : ''}
            </p>
          </div>
          <Link href="/profile" className="theme-btn" style={{ fontSize: 13, padding: '8px 16px' }}>
            {completionPct >= 80 ? 'Edit Profile' : `Complete Profile (${completionPct}%)`}
          </Link>
        </div>

        {/* Compact progress bar */}
        {completionPct < 100 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 6, borderRadius: 6, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
              <div style={{
                height: 6, borderRadius: 6,
                width: `${completionPct}%`,
                background: completionPct >= 80 ? '#10b981' : '#f59e0b',
                transition: 'width .4s ease',
              }} />
            </div>
            {Array.isArray(completion?.missingRequired) && completion.missingRequired.length > 0 && (
              <p style={{ margin: '5px 0 0', fontSize: 11, color: '#9ca3af' }}>
                Profile incomplete — missing: {completion.missingRequired.slice(0, 4).join(', ')}
                {completion.missingRequired.length > 4 ? ` +${completion.missingRequired.length - 4} more` : ''}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {([
          ['Contests Open', opportunities.length, '#7c3aed'],
          ['Total Applied', summary.total || 0, '#3b82f6'],
          ['Submitted', summary.submitted || 0, '#10b981'],
          ['Needs Action', summary.pendingCorrections || 0, '#f59e0b'],
        ] as [string, number, string][]).map(([label, value, color]) => (
          <div key={label} className="glass-card rounded-md" style={{ padding: '12px 14px' }}>
            <p style={{ margin: '0 0 2px', fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>{label}</p>
            <p style={{ margin: 0, fontSize: 24, fontWeight: 700, color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb' }}>
        {([
          ['contests',     `Contests (${opportunities.length})`],
          ['applications', `My Applications (${applications.length})`],
          ['overview',     'Overview'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => { setActiveTab(t); setSearch(''); setTypeFilter(''); setStatusFilter(''); }}
            style={{
              border: 'none', background: 'none', cursor: 'pointer',
              padding: '10px 16px', fontSize: 13, fontWeight: 600,
              borderBottom: activeTab === t ? '2px solid #f59e0b' : '2px solid transparent',
              color: activeTab === t ? '#f59e0b' : '#6b7280',
              marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB: All Contests ─────────────────────────────────────────────── */}
      {activeTab === 'contests' && (
        <div>
          {/* Search + filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search contests…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: '1 1 180px', border: '1px solid #d1d5db', borderRadius: 8,
                padding: '8px 12px', fontSize: 13, outline: 'none',
              }}
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, background: '#fff' }}
            >
              <option value="">All Types</option>
              {contestTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showApplied}
                onChange={(e) => setShowApplied(e.target.checked)}
                style={{ accentColor: '#f59e0b' }}
              />
              Applied only
            </label>
          </div>

          {filteredContests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ca3af' }}>
              <p style={{ fontSize: 32, marginBottom: 8 }}>🔍</p>
              <p>{search || typeFilter ? 'No contests match your search.' : 'No open contests right now. Check back soon.'}</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
              {filteredContests.map((item) => {
                const userApp = appsByProgramId[item.id] || appsByProgramId[item.slug];
                return <ContestCard key={item.id} item={item} userApp={userApp} />;
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: My Applications ─────────────────────────────────────────── */}
      {activeTab === 'applications' && (
        <div>
          {/* Search + status filter */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search applications…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: '1 1 180px', border: '1px solid #d1d5db', borderRadius: 8,
                padding: '8px 12px', fontSize: 13, outline: 'none',
              }}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: '#fff' }}
            >
              <option value="">All Statuses</option>
              {['draft', 'submitted', 'under_review', 'shortlisted', 'approved', 'rejected', 'correction_requested'].map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </div>

          {filteredApps.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ca3af' }}>
              <p style={{ fontSize: 32, marginBottom: 8 }}>📋</p>
              {applications.length === 0
                ? <p>You haven't applied to any contests yet. <button onClick={() => setActiveTab('contests')} style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit' }}>Browse contests →</button></p>
                : <p>No applications match your filter.</p>
              }
            </div>
          ) : (
            <div className="glass-card rounded-md" style={{ padding: '0 16px' }}>
              {filteredApps.map((item) => (
                <ApplicationRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Overview ────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Application breakdown by type */}
          {applications.length > 0 && (
            <div className="glass-card rounded-md" style={{ padding: 16 }}>
              <h5 style={{ marginBottom: 12, fontWeight: 700 }}>Application Breakdown</h5>
              {(['draft', 'submitted', 'under_review', 'shortlisted', 'approved', 'rejected', 'correction_requested'] as const).map((s) => {
                const count = applications.filter((a) => a.status.toLowerCase().replace(/\s+/g, '_') === s).length;
                if (!count) return null;
                return (
                  <div key={s} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                    <span>{statusLabel(s)}</span>
                    <span
                      style={{
                        fontWeight: 700, padding: '1px 10px', borderRadius: 20, fontSize: 11,
                        ...Object.fromEntries(statusStyle(s).split(';').map((x) => x.split(':').map((y) => y.trim()))),
                      }}
                    >
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recent 5 applications */}
          {applications.length > 0 && (
            <div className="glass-card rounded-md" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h5 style={{ margin: 0, fontWeight: 700 }}>Recent Applications</h5>
                <button onClick={() => setActiveTab('applications')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f59e0b', fontSize: 12, textDecoration: 'underline' }}>View all</button>
              </div>
              {applications.slice(0, 5).map((item) => (
                <ApplicationRow key={item.id} item={item} />
              ))}
            </div>
          )}

          {/* Upcoming deadlines */}
          {(() => {
            const upcoming = opportunities
              .filter((o) => {
                const d = daysUntil(o.deadline);
                return d !== null && d >= 0 && d <= 14;
              })
              .sort((a, b) => Date.parse(a.deadline!) - Date.parse(b.deadline!))
              .slice(0, 5);
            if (!upcoming.length) return null;
            return (
              <div className="glass-card rounded-md" style={{ padding: 16 }}>
                <h5 style={{ margin: '0 0 12px', fontWeight: 700 }}>⏱ Closing Soon</h5>
                {upcoming.map((o) => {
                  const d = daysUntil(o.deadline)!;
                  const userApp = appsByProgramId[o.id] || appsByProgramId[o.slug];
                  return (
                    <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6', gap: 8 }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{o.title}</p>
                        <p style={{ margin: 0, fontSize: 11, color: d <= 3 ? '#dc2626' : '#d97706', fontWeight: 600 }}>
                          {d === 0 ? 'Closes today' : `${d} day${d !== 1 ? 's' : ''} left`}
                        </p>
                      </div>
                      {!userApp ? (
                        <Link href={o.applyHref} style={{ background: '#f59e0b', color: '#000', fontWeight: 700, fontSize: 11, padding: '5px 12px', borderRadius: 7, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          Apply Now
                        </Link>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, ...Object.fromEntries(statusStyle(userApp.status).split(';').map((x) => x.split(':').map((y) => y.trim()))) }}>
                          {statusLabel(userApp.status)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

    </div>
  );
}
