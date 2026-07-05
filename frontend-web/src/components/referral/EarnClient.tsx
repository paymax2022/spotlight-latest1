'use client';

// ── Earn (Referral Rewards) — member UI, LIVE against the backend ─────────────
// Data comes exclusively from the Go Direct Rewards engine via /api/v1/referrals/*.
// No mock data. All money is integer kobo, formatted for display only.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getDashboard,
  getOrCreateLink,
  listReferrals,
  listEarnings,
  getMilestones,
  ReferralApiError,
  type ReferralDashboard,
  type ReferredUser,
  type RewardEntry,
  type MilestonesResponse,
} from '@/src/lib/referral/api';
import { formatNaira, formatRate, formatDate, tierLabel, shareMessage } from '@/src/lib/referral/format';

type LoadState = 'loading' | 'ready' | 'error' | 'unavailable';

const REFERRAL_LINK_BASE =
  process.env.NEXT_PUBLIC_REFERRAL_LINK_BASE ?? 'https://spotlight.ng/j';

function statusTone(status: string): string {
  switch (status.toUpperCase()) {
    case 'CREDITED':
      return 'bg-green-100 text-green-700';
    case 'PENDING':
      return 'bg-amber-100 text-amber-700';
    case 'REVERSED':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

export default function EarnClient() {
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string>('');
  const [dashboard, setDashboard] = useState<ReferralDashboard | null>(null);
  const [referrals, setReferrals] = useState<ReferredUser[]>([]);
  const [earnings, setEarnings] = useState<RewardEntry[]>([]);
  const [milestones, setMilestones] = useState<MilestonesResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      // Dashboard first — it also guarantees a code exists via the engine.
      const dash = await getDashboard().catch(async (e) => {
        // If the caller has no code yet, mint one then retry.
        if (e instanceof ReferralApiError && (e.status === 404 || e.status === 400)) {
          await getOrCreateLink();
          return getDashboard();
        }
        throw e;
      });
      const [refs, earn, ms] = await Promise.all([
        listReferrals({ limit: 50 }),
        listEarnings({ limit: 50 }),
        getMilestones(),
      ]);
      setDashboard(dash);
      setReferrals(refs);
      setEarnings(earn);
      setMilestones(ms);
      setState('ready');
    } catch (e) {
      if (e instanceof ReferralApiError && e.status === 503) {
        setState('unavailable');
        return;
      }
      if (e instanceof ReferralApiError && e.status === 401) {
        // redirect already triggered inside the api layer
        return;
      }
      setError(e instanceof Error ? e.message : 'Something went wrong loading your rewards.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const link = useMemo(() => {
    if (!dashboard?.code) return '';
    return `${REFERRAL_LINK_BASE}/${dashboard.code}`;
  }, [dashboard?.code]);

  const copyLink = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }, [link]);

  const share = useCallback(async () => {
    if (!dashboard?.code) return;
    const text = shareMessage(dashboard.code, link);
    const nav = navigator as Navigator & { share?: (d: { text: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ text, url: link });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    await copyLink();
  }, [dashboard?.code, link, copyLink]);

  if (state === 'loading') {
    return <div className="py-5 text-center text-muted">Loading your rewards…</div>;
  }

  if (state === 'unavailable') {
    return (
      <div className="py-5 text-center">
        <h4>Earn is coming soon</h4>
        <p className="text-muted">Referral rewards aren’t switched on for your account yet.</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="py-5 text-center">
        <p className="text-danger">{error}</p>
        <button className="theme-btn mt-3" onClick={() => void load()} type="button">
          Try again
        </button>
      </div>
    );
  }

  const next = dashboard?.next_milestone;
  const progressPct =
    next && next.threshold > 0
      ? Math.min(100, Math.round(((next.threshold - next.remaining) / next.threshold) * 100))
      : null;

  return (
    <div className="referral-earn" style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Hero: code + share */}
      <div
        className="p-4 mb-4 rounded"
        style={{ background: 'var(--theme, #6a2c91)', color: '#fff', borderRadius: 16 }}
      >
        <div className="d-flex flex-wrap align-items-center justify-content-between" style={{ gap: 16 }}>
          <div>
            <div style={{ opacity: 0.85, fontSize: 14 }}>Your referral code</div>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 1 }}>{dashboard?.code}</div>
            <div style={{ opacity: 0.85, fontSize: 13, wordBreak: 'break-all' }}>{link}</div>
          </div>
          <div className="d-flex" style={{ gap: 10 }}>
            <button className="theme-btn" type="button" onClick={() => void copyLink()}>
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button className="theme-btn" type="button" onClick={() => void share()}>
              Share
            </button>
          </div>
        </div>
        <p style={{ marginTop: 14, marginBottom: 0, opacity: 0.9, fontSize: 13 }}>
          You earn when someone you referred makes a purchase — never just for referring them.
        </p>
      </div>

      {/* Stat cards */}
      <div className="row g-3 mb-4">
        <StatCard label="Current tier" value={`${tierLabel(dashboard?.current_tier ?? '')} · ${formatRate(dashboard?.current_rate)}`} />
        <StatCard label="Active referrals" value={String(dashboard?.active_referral_count ?? 0)} />
        <StatCard label="Earned this month" value={formatNaira(dashboard?.this_month_earned_kobo)} />
        <StatCard label="Lifetime earned" value={formatNaira(dashboard?.lifetime_earned_kobo)} />
      </div>

      {/* Next milestone */}
      {next && (
        <div className="p-3 mb-4 rounded" style={{ border: '1px solid #eee', borderRadius: 12 }}>
          <div className="d-flex justify-content-between">
            <strong>Next milestone</strong>
            <span className="text-muted">
              {next.remaining} more active → {formatNaira(next.bonus_kobo)} bonus
            </span>
          </div>
          {progressPct != null && (
            <div style={{ background: '#eee', borderRadius: 999, height: 10, marginTop: 10 }}>
              <div
                style={{
                  width: `${progressPct}%`,
                  height: 10,
                  borderRadius: 999,
                  background: 'var(--theme, #6a2c91)',
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Referred users */}
      <Section title={`Your referrals (${referrals.length})`}>
        {referrals.length === 0 ? (
          <EmptyRow text="No referrals yet — share your code to get started." />
        ) : (
          <ul className="list-unstyled m-0">
            {referrals.map((r) => (
              <li
                key={r.referred_user_id}
                className="d-flex justify-content-between align-items-center py-2"
                style={{ borderBottom: '1px solid #f2f2f2' }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{r.masked_contact}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    Joined {formatDate(r.joined_at)} · {r.active ? 'Active' : 'Inactive'}
                  </div>
                </div>
                <div style={{ fontWeight: 600 }}>{formatNaira(r.lifetime_earned_kobo)}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Earnings ledger */}
      <Section title={`Earnings (${earnings.length})`}>
        {earnings.length === 0 ? (
          <EmptyRow text="No earnings yet. You earn a share of the platform margin when a referral transacts." />
        ) : (
          <ul className="list-unstyled m-0">
            {earnings.map((e) => (
              <li
                key={e.id}
                className="d-flex justify-content-between align-items-center py-2"
                style={{ borderBottom: '1px solid #f2f2f2' }}
              >
                <div>
                  <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{e.module}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {formatDate(e.created_at)} · {formatRate(e.applied_rate)} of {formatNaira(e.margin_kobo)}
                  </div>
                </div>
                <div className="d-flex align-items-center" style={{ gap: 10 }}>
                  <span className={`px-2 py-1 rounded ${statusTone(e.status)}`} style={{ fontSize: 11, borderRadius: 8 }}>
                    {e.status}
                  </span>
                  <span style={{ fontWeight: 600 }}>{formatNaira(e.reward_kobo)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Milestones */}
      {milestones && (milestones.achieved.length > 0 || milestones.upcoming.length > 0) && (
        <Section title="Milestone bonuses">
          <div className="row g-3">
            {[...milestones.achieved.map((m) => ({ ...m, done: true })), ...milestones.upcoming.map((m) => ({ ...m, done: false }))].map(
              (m, i) => (
                <div className="col-6 col-md-3" key={`${m.threshold}-${i}`}>
                  <div
                    className="p-3 text-center rounded"
                    style={{
                      border: '1px solid #eee',
                      borderRadius: 12,
                      opacity: m.done ? 1 : 0.7,
                    }}
                  >
                    <div style={{ fontSize: 13 }} className="text-muted">
                      {m.threshold} referrals
                    </div>
                    <div style={{ fontWeight: 700 }}>{formatNaira(m.bonus_kobo)}</div>
                    <div style={{ fontSize: 12 }} className={m.done ? 'text-success' : 'text-muted'}>
                      {m.done ? (m.status ? m.status : 'Achieved') : 'Upcoming'}
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="col-6 col-md-3">
      <div className="p-3 rounded h-100" style={{ border: '1px solid #eee', borderRadius: 12 }}>
        <div className="text-muted" style={{ fontSize: 12 }}>
          {label}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h5 className="mb-3">{title}</h5>
      {children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="py-3 text-muted" style={{ fontSize: 14 }}>
      {text}
    </div>
  );
}
