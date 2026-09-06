'use client';

import Link from 'next/link';

/**
 * Shared admin UI primitives — the pieces every module dashboard needs but none
 * of them had.
 *
 * CONTEXT. There are 40 `_ui.tsx` files under app/admin, one per module, all
 * distinct: ~5,500 lines of the same primitives copied and drifted. `PageHeader`
 * is defined 26 times, `Card` 25, `Kpi` 20, `Badge` 19. Their public APIs never
 * diverged — every `Kpi` still takes { label, value, sub, accent } — so the drift
 * is in implementation, not contract.
 *
 * This file does NOT try to replace those 40 kits in one sweep. It adds the two
 * things none of them have, so a module dashboard can be improved without first
 * rewriting its kit:
 *
 *   ActionKpi      — a metric that LINKS to the work when there is work to do.
 *   AttentionStrip — the queue summary, hoisted to the top of a dashboard.
 *
 * WHY THIS IS THE MISSING PIECE. 18 of the 21 module dashboards already fetch a
 * pending count — invites_pending, pending_moderation, open_cases — and render it
 * as a passive number, sometimes tinted orange. An admin reads "7 pending", then
 * has to work out which page shows those 7 and navigate there themselves. The
 * number names the work without reaching it. These components close that gap.
 */

/** Tokens taken from the values the existing kits already agree on. */
export const tone = {
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  surface: '#ffffff',
  ok: '#15803d',
  warn: '#9a3412',
  warnBg: '#ffedd5',
  danger: '#b91c1c',
  dangerBg: '#fee2e2',
  brand: '#7c3aed',
};

/**
 * Renders a count, or an em dash when it is unknown.
 *
 * null/undefined means "we could not read this", which is NOT zero. An empty
 * queue and an unreadable one look identical if both render "0", and only one of
 * them means there is nothing to do.
 */
export function fmtCount(n: number | null | undefined): string {
  return typeof n === 'number' ? n.toLocaleString('en-NG') : '—';
}

export type AttentionItem = {
  label: string;
  value: number | null | undefined;
  /** Where the work actually is — a filtered queue, not the module's home page. */
  href: string;
  /** critical: money or compliance is blocked. warn: an ops/content backlog. */
  severity?: 'critical' | 'warn';
};

/**
 * A single metric that becomes a link when it has work in it.
 *
 * With no work it stays deliberately plain: a zero queue is not a call to
 * action, and tinting every tile teaches people to ignore the tint.
 */
export function ActionKpi({ label, value, sub, href, severity = 'warn' }: AttentionItem & { sub?: string }) {
  const active = typeof value === 'number' && value > 0;
  const accent = severity === 'critical' ? tone.danger : tone.warn;

  const body = (
    <>
      <div style={{ fontSize: '0.78rem', color: tone.muted }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: 4, color: active ? accent : tone.text }}>
        {fmtCount(value)}
      </div>
      {sub ? <div style={{ fontSize: '0.75rem', color: tone.muted, marginTop: 2 }}>{sub}</div> : null}
      {active ? (
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: accent, marginTop: 8 }}>Open queue →</div>
      ) : null}
    </>
  );

  const box: React.CSSProperties = {
    border: `1px solid ${active ? accent : tone.border}`,
    background: active ? (severity === 'critical' ? tone.dangerBg : tone.warnBg) : tone.surface,
    borderRadius: 10,
    padding: '0.85rem 1rem',
    display: 'block',
    textDecoration: 'none',
    color: 'inherit',
  };

  // Only clickable when there is something to click through TO. A link to an
  // empty queue is a dead end that still looks like an action.
  return active ? <Link href={href} style={box}>{body}</Link> : <div style={box}>{body}</div>;
}

/**
 * The queue summary for one module, meant to sit directly under the page header
 * — above the vanity metrics, because it is the reason to open the page.
 *
 * Items with no work are not hidden: an admin needs to see that a queue was
 * checked and is empty, which is different from it being absent. Unknown values
 * render "—" and are never silently dropped.
 */
export function AttentionStrip({ items, note }: { items: AttentionItem[]; note?: string }) {
  if (items.length === 0) return null;

  const outstanding = items.filter((i) => typeof i.value === 'number' && i.value > 0);
  const unknown = items.filter((i) => typeof i.value !== 'number');

  return (
    <section
      style={{
        border: `1px solid ${tone.border}`,
        borderLeft: `4px solid ${outstanding.length > 0 ? tone.warn : tone.ok}`,
        borderRadius: 10,
        padding: '0.9rem 1rem',
        marginBottom: '1.25rem',
        background: tone.surface,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <strong style={{ fontSize: '0.95rem' }}>Needs attention</strong>
        <span style={{ fontSize: '0.75rem', color: tone.muted }}>
          {outstanding.length === 0
            ? unknown.length > 0
              ? `no outstanding work in the queues that answered — ${unknown.length} could not be read`
              : 'all queues clear'
            : `${outstanding.length} queue${outstanding.length === 1 ? '' : 's'} with work`}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: '0.75rem',
          marginTop: '0.85rem',
        }}
      >
        {items.map((i) => (
          <ActionKpi key={`${i.label}-${i.href}`} {...i} />
        ))}
      </div>

      {note ? <p style={{ fontSize: '0.75rem', color: tone.muted, margin: '0.75rem 0 0' }}>{note}</p> : null}
    </section>
  );
}

/**
 * Says, unmissably, that the numbers on screen are invented.
 *
 * WHY THIS EXISTS. 34 admin services are serving fixtures right now, and 19 of
 * the 21 module dashboards render them with nothing on screen to say so.
 * /admin/creators/dashboard reports ₦603,400,000 of creator earnings, 12,840
 * creators and 412 items pending moderation — all literals in
 * creatorsAdminService.ts. An admin cannot tell that page from a live one.
 *
 * Worse than a dev convenience: 48 of those services gate on
 * `(process.env.X ?? 'true').toLowerCase() !== 'false'`, which never consults
 * NODE_ENV. A PRODUCTION build with the variable unset serves fixtures too. Only
 * three services use src/config/useMock.ts's resolveUseMock(), which correctly
 * falls back to live outside development.
 *
 * `active` is passed in from the service's own exported flag rather than
 * recomputed here. A banner that derives the answer separately can disagree with
 * the code that actually chose the data — and a fixture banner that is wrong in
 * the reassuring direction is worse than none.
 */
export function FixtureBanner({ active, envVar }: { active: boolean; envVar?: string }) {
  if (!active) return null;
  return (
    <div
      role="status"
      style={{
        border: `1px solid ${tone.danger}`,
        background: tone.dangerBg,
        color: tone.danger,
        borderRadius: 10,
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
        fontSize: '0.85rem',
        lineHeight: 1.5,
      }}
    >
      <strong>Sample data — not this platform&rsquo;s figures.</strong> Every number below is a
      fixture defined in the service file. Do not report, reconcile or make decisions from it.
      {envVar ? (
        <>
          {' '}Set <code style={{ fontFamily: 'ui-monospace, monospace' }}>{envVar}=false</code> to read the live backend.
        </>
      ) : null}
    </div>
  );
}
