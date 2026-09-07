'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { AdminMenuCounts } from '@/types/admin';
import type { AdminOverview, OverviewModule } from '@/types/adminOverview';
import { getAdminMenuCounts, getAdminOverview } from '@/services/adminApiClient';
import { canManageStem, canReadStem, getCurrentStemRole } from '@/config/stemAccess';
import { quickLinks } from './quickLinks';

/**
 * THE REDESIGN, AND WHY.
 *
 * What this replaced: eight counters — contestants, open mic, auditions, reality
 * TV, academy, SME pitch, STEM, bootcamp — under the heading "Spotlight
 * Analytics". Every one belonged to the legacy programme business, while the
 * console behind it now houses ~79 route groups covering wallets, marketplace,
 * restaurant, stays, health, insurance, crowdfunding, crypto and more. An admin
 * opening this page learned how many contestants existed and nothing about the
 * money moving through the platform.
 *
 * Three principles drive the new layout:
 *
 * 1. WORK FIRST, VOLUME SECOND. "20 live listings" is trivia; "11 listings
 *    awaiting moderation" is a job. Every module reports a queue, the queues with
 *    work outstanding are hoisted to the top, and each one links to the FILTERED
 *    view rather than the module's front door — so the dashboard ends at the work
 *    itself, not one more click away from it.
 *
 * 2. UNKNOWN IS NOT ZERO. A module whose count could not be read renders "—" and
 *    is named in a degraded-modules line. Rendering it as 0 would tell an on-call
 *    admin that a queue is empty when it was never actually read.
 *
 * 3. NOTHING DECORATIVE. The old card carried a progress bar hardcoded to 72% —
 *    it looked like a measurement and was a literal constant. Everything drawn
 *    here is a number the backend returned.
 *
 * The legacy programme counters are NOT deleted; they move into the Programs
 * group, which is what they always were — one domain among many.
 */

const C = {
  primary: '#7367f0',
  primaryDark: '#655bd8',
  green: '#28c76f',
  cyan: '#00cfe8',
  orange: '#ff9f43',
  red: '#ff4c51',
  text: '#2f2b3d',
  muted: '#6f6b7d',
  border: '#ebe9f1',
  bg: '#f8f7fa',
};

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** null renders as an em dash — never as 0. See principle 2 above. */
function fmt(n: number | null | undefined): string {
  return typeof n === 'number' ? n.toLocaleString('en-NG') : '—';
}

const card: CSSProperties = {
  background: '#fff',
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 18,
  boxShadow: '0 4px 18px rgba(47,43,61,0.06)',
};
const sectionTitle: CSSProperties = { margin: 0, fontSize: 17, fontWeight: 700, color: C.text };

/** Domain order — money and live commerce before programmes. */
const GROUP_ORDER = ['Money', 'Commerce', 'Travel', 'Health', 'Community', 'Programs'];

export function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [counts, setCounts] = useState<AdminMenuCounts | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const role = getCurrentStemRole();
  const visibleQuickLinks = quickLinks.filter((item) => {
    if (item.stemAccess === 'read') return canReadStem(role);
    if (item.stemAccess === 'manage') return canManageStem(role);
    return true;
  });

  const load = useCallback(() => {
    setLoaded(false);
    setFailed(false);
    // Independent on purpose: the legacy programme counters come from a different
    // endpoint, and one being down must not blank the other.
    Promise.allSettled([getAdminOverview(), getAdminMenuCounts()]).then(([o, c]) => {
      const ov = o.status === 'fulfilled' ? o.value : null;
      setOverview(ov);
      setCounts(c.status === 'fulfilled' ? c.value : null);
      setFailed(!ov);
      setLoaded(true);
    });
  }, []);

  useEffect(load, [load]);

  const modules = useMemo<OverviewModule[]>(() => {
    const live = overview?.modules ?? [];
    if (!counts) return live;
    // The legacy programme counters, folded in as a peer domain rather than as
    // the headline. Their queue is the registration review backlog, which the
    // overview endpoint already reports, so these carry volume only.
    const programme: OverviewModule[] = [
      { key: 'contestants', label: 'Contestants', group: 'Programs', href: '/admin/contests',
        volume: { label: 'Registered', value: counts.contestants ?? null },
        attention: { label: '', value: 0, href: '/admin/contests', severity: 'warn' } },
      { key: 'open-mic', label: 'Open Mic', group: 'Programs', href: '/admin/open-mic',
        volume: { label: 'Submissions', value: counts.open_mic ?? null },
        attention: { label: '', value: 0, href: '/admin/open-mic', severity: 'warn' } },
      { key: 'auditions', label: 'Auditions', group: 'Programs', href: '/admin/competitions',
        volume: { label: 'In queue', value: counts.auditions ?? null },
        attention: { label: '', value: 0, href: '/admin/competitions', severity: 'warn' } },
      { key: 'academy', label: 'Academy', group: 'Programs', href: '/admin/academy',
        volume: { label: 'Applications', value: counts.academy ?? null },
        attention: { label: '', value: 0, href: '/admin/academy', severity: 'warn' } },
    ];
    return [...live, ...programme];
  }, [overview, counts]);

  /** Only modules with work outstanding, worst first. */
  const needsAttention = useMemo(
    () =>
      modules
        .filter((m) => typeof m.attention.value === 'number' && m.attention.value > 0)
        .sort((a, b) => {
          if (a.attention.severity !== b.attention.severity) return a.attention.severity === 'critical' ? -1 : 1;
          return (b.attention.value ?? 0) - (a.attention.value ?? 0);
        }),
    [modules],
  );

  /** Named explicitly so "could not read" never hides behind a zero. */
  const degraded = useMemo(
    () => modules.filter((m) => m.volume.value === null || m.attention.value === null),
    [modules],
  );

  const grouped = useMemo(() => {
    const by = new Map<string, OverviewModule[]>();
    for (const m of modules) by.set(m.group, [...(by.get(m.group) ?? []), m]);
    return [...by.entries()].sort(
      (a, b) => (GROUP_ORDER.indexOf(a[0]) + 1 || 99) - (GROUP_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [modules]);

  const criticalTotal = needsAttention
    .filter((m) => m.attention.severity === 'critical')
    .reduce((sum, m) => sum + (m.attention.value ?? 0), 0);

  return (
    <div style={{ color: C.text, background: C.bg, minHeight: '100%', margin: -24, padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800 }}>Operations</h1>
          <p style={{ margin: '4px 0 0', color: C.muted }}>
            Queues and volume across every module. Metrics link to the work, not the front door.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 14px',
            fontSize: 13, fontWeight: 600, color: C.text, cursor: 'pointer' }}
        >
          {loaded ? 'Refresh' : 'Loading…'}
        </button>
      </div>

      {/* ---- Needs attention: the reason to open this page at all. ---- */}
      <section style={{ ...card, marginBottom: 16, borderLeft: `4px solid ${criticalTotal > 0 ? C.red : C.green}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={sectionTitle}>Needs attention</h2>
          <span style={{ fontSize: 12, color: C.muted }}>
            {overview?.generated_at ? `as of ${new Date(overview.generated_at).toLocaleTimeString('en-NG')}` : ''}
          </span>
        </div>

        {!loaded ? (
          <p style={{ color: C.muted, margin: '12px 0 0', fontSize: 13 }}>Reading queues…</p>
        ) : failed ? (
          <p style={{ color: C.red, margin: '12px 0 0', fontSize: 13 }}>
            The overview API did not answer, so no queue is being reported here. This is not an all-clear —
            check the backend is running before treating it as one.
          </p>
        ) : needsAttention.length === 0 ? (
          <p style={{ color: C.muted, margin: '12px 0 0', fontSize: 13 }}>
            Every queue that answered is empty{degraded.length > 0 ? `, but ${degraded.length} module(s) could not be read — see below.` : '.'}
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))', gap: 12, marginTop: 14 }}>
            {needsAttention.map((m) => {
              const tint = m.attention.severity === 'critical' ? C.red : C.orange;
              return (
                <Link
                  key={m.key}
                  href={m.attention.href}
                  style={{ textDecoration: 'none', color: 'inherit', display: 'block', border: `1px solid ${rgba(tint, 0.35)}`,
                    background: rgba(tint, 0.06), borderRadius: 10, padding: '12px 14px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{m.label}</span>
                    <span style={{ fontSize: 22, fontWeight: 800, color: tint }}>{fmt(m.attention.value)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{m.attention.label}</div>
                  <div style={{ fontSize: 12, color: tint, fontWeight: 600, marginTop: 8 }}>Open queue →</div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- Everything, by domain. ---- */}
      {grouped.map(([group, mods]) => (
        <section key={group} style={{ marginBottom: 16 }}>
          <h2 style={{ ...sectionTitle, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, marginBottom: 10 }}>
            {group}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))', gap: 14 }}>
            {mods.map((m) => (
              <div key={m.key} style={card}>
                <Link href={m.href} style={{ textDecoration: 'none', color: C.text, fontSize: 14, fontWeight: 700 }}>
                  {m.label}
                </Link>
                <div style={{ fontSize: 27, fontWeight: 800, marginTop: 8 }}>{loaded ? fmt(m.volume.value) : '—'}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{m.volume.label}</div>

                {m.attention.label ? (
                  <Link
                    href={m.attention.href}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}`, textDecoration: 'none' }}
                  >
                    <span style={{ fontSize: 12, color: C.muted }}>{m.attention.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 800,
                      color: (m.attention.value ?? 0) > 0
                        ? (m.attention.severity === 'critical' ? C.red : C.orange)
                        : C.muted }}>
                      {loaded ? fmt(m.attention.value) : '—'}
                    </span>
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* ---- Quick actions + honest status. ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16 }}>
        <div style={card}>
          <h2 style={sectionTitle}>Quick actions</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {visibleQuickLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{ textDecoration: 'none', color: C.primary, border: `1px solid ${rgba(C.primary, 0.5)}`,
                  borderRadius: 6, padding: '7px 11px', fontSize: 12, fontWeight: 600, background: rgba(C.primary, 0.05) }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div style={card}>
          <h2 style={sectionTitle}>Data status</h2>
          <ul style={{ margin: '14px 0 0', paddingLeft: 18, color: C.muted, fontSize: 13, lineHeight: 1.9 }}>
            <li>
              Overview API:{' '}
              <strong style={{ color: failed ? C.red : C.green }}>
                {!loaded ? 'loading…' : failed ? 'unreachable' : 'connected'}
              </strong>
            </li>
            <li>
              {modules.length} module{modules.length === 1 ? '' : 's'} reporting
              {degraded.length > 0 ? (
                <>
                  ,{' '}
                  <strong style={{ color: C.orange }}>
                    {degraded.length} could not be read
                  </strong>{' '}
                  ({degraded.map((m) => m.label).join(', ')}) — shown as “—”, not as zero.
                </>
              ) : (
                ', all answered.'
              )}
            </li>
            <li>Signed in as <strong style={{ color: C.text }}>{role}</strong>.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
