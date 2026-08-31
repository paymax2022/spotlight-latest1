'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational helpers for the Insurance console — matches the Connect /
// Referral admin light-card inline-style convention. All insurance pages import
// from this file via relative path, so everything they need is exported here.

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.primary}`, background: colors.primary, color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.danger}`, background: colors.card, color: colors.danger, fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.headBg}` });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: colors.card, cursor: 'pointer' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // generic / lifecycle
  active: { fg: colors.success, bg: tint(colors.success, 0.12) }, approved: { fg: colors.success, bg: tint(colors.success, 0.12) },
  settled: { fg: colors.success, bg: tint(colors.success, 0.12) }, renewed: { fg: colors.success, bg: tint(colors.success, 0.12) },
  reconciled: { fg: colors.success, bg: tint(colors.success, 0.12) }, matched: { fg: colors.success, bg: tint(colors.success, 0.12) },
  resolved: { fg: colors.success, bg: tint(colors.success, 0.12) }, paid: { fg: colors.success, bg: tint(colors.success, 0.12) },
  healthy: { fg: colors.success, bg: tint(colors.success, 0.12) }, up: { fg: colors.success, bg: tint(colors.success, 0.12) },
  open: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  pending_payment: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, payout_pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  binding: { fg: colors.info, bg: tint(colors.info, 0.12) }, quoted: { fg: colors.info, bg: tint(colors.info, 0.12) },
  under_assessment: { fg: colors.info, bg: tint(colors.info, 0.12) }, fnol_submitted: { fg: colors.info, bg: tint(colors.info, 0.12) },
  needs_more_info: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, renewal_due: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  investigating: { fg: colors.info, bg: tint(colors.info, 0.12) }, reviewing: { fg: colors.info, bg: tint(colors.info, 0.12) },
  draft: { fg: colors.muted, bg: colors.headBg }, expired: { fg: colors.muted, bg: colors.headBg },
  closed: { fg: colors.muted, bg: colors.headBg }, cancelled: { fg: colors.muted, bg: colors.headBg },
  void: { fg: colors.muted, bg: colors.headBg }, inactive: { fg: colors.muted, bg: colors.headBg },
  rejected: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, lapsed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, bind_failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  payment_failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, break: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  unmatched: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, down: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  degraded: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, reversed: { fg: '#7c3aed', bg: tint('#7c3aed', 0.12) },
  // severity
  low: { fg: colors.muted, bg: colors.headBg }, normal: { fg: colors.info, bg: tint(colors.info, 0.12) },
  medium: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, high: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  critical: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  // binding mode
  embedded: { fg: '#7c3aed', bg: tint('#7c3aed', 0.12) }, voluntary: { fg: colors.info, bg: tint(colors.info, 0.12) },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: colors.text, bg: colors.headBg };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{lbl ?? status.replace(/_/g, ' ')}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{title}</h1>
        {subtitle ? <p style={{ color: colors.muted, margin: '0.25rem 0 0', fontSize: '0.85rem', maxWidth: 820 }}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, children, right }: PropsWithChildren<{ title?: string; right?: ReactNode }>) {
  return (
    <div style={{ ...card(), marginBottom: '1.25rem' }}>
      {title ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Kpi({ label: lbl, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.85rem 1rem', background: colors.card }}>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{lbl}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.15rem' }}>{sub}</div> : null}
    </div>
  );
}

export function InsuranceTabs({ active }: { active: string }) {
  const tabs = [
    { href: '/admin/insurance/dashboard', label: 'Overview', key: 'dashboard' },
    { href: '/admin/insurance/catalog', label: 'Catalog', key: 'catalog' },
    { href: '/admin/insurance/policies', label: 'Policies', key: 'policies' },
    { href: '/admin/insurance/claims', label: 'Claims', key: 'claims' },
    { href: '/admin/insurance/commission', label: 'Commission', key: 'commission' },
    { href: '/admin/insurance/reconciliation', label: 'Reconciliation', key: 'reconciliation' },
    { href: '/admin/insurance/providers', label: 'Providers', key: 'providers' },
    { href: '/admin/insurance/premiums', label: 'Finance', key: 'finance' },
    { href: '/admin/insurance/reports', label: 'Ops', key: 'ops' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.headBg }}>{t.label}</Link>
      ))}
    </div>
  );
}

// Standard loading / empty / error placeholders so every list page is consistent.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: colors.muted }}>Loading…</p>;
  if (error) return <p style={{ color: colors.danger }}>{error}</p>;
  if (empty) return <p style={{ color: colors.muted }}>{emptyText}</p>;
  return <>{children}</>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Honest state rendering
//
// These exist because the alternative — a console that fills gaps with plausible
// numbers — is the failure mode this whole screen set was rebuilt to remove. An
// operator must always be able to tell three things apart:
//   1. the backend reported a value (show it),
//   2. the backend reported nothing for this field (show "not reported"),
//   3. the call failed (show what failed, where, and why).
// Never collapse (2) or (3) into a zero.
// ═══════════════════════════════════════════════════════════════════════════

/** Placeholder for a field the backend did not report. Never a 0. */
export function NotReported({ hint }: { hint?: string }) {
  return (
    <span style={{ color: colors.muted, fontStyle: 'italic', fontSize: '0.85rem' }} title={hint ?? 'Not reported by the API'}>
      not reported
    </span>
  );
}

/** The shape `InsuranceAdminError` presents to the UI (structurally typed so
 *  _ui.tsx does not need to import the service). */
export interface EndpointFailure {
  kind: string;
  status: number;
  method: string;
  path: string;
  detail: string | null;
  headline: string;
  explanation: string;
}

export function toFailure(e: unknown): EndpointFailure {
  const o = e as Partial<EndpointFailure> & { message?: string };
  if (o && typeof o === 'object' && typeof o.path === 'string' && typeof o.headline === 'string') {
    return {
      kind: o.kind ?? 'unknown',
      status: o.status ?? 0,
      method: o.method ?? 'GET',
      path: o.path,
      detail: o.detail ?? null,
      headline: o.headline,
      explanation: o.explanation ?? '',
    };
  }
  return {
    kind: 'unknown',
    status: 0,
    method: '',
    path: '',
    detail: null,
    headline: 'Unexpected error',
    explanation: String((o && o.message) || e),
  };
}

/**
 * Renders a failed endpoint call as something an operator can act on: the exact
 * request, the HTTP status, the backend's own message, and what that class of
 * failure means. A 404 is styled as a neutral "not built yet" rather than a red
 * alarm, because a missing endpoint is a roadmap fact, not an incident.
 */
export function EndpointErrorCard({ failure, onRetry }: { failure: EndpointFailure; onRetry?: () => void }) {
  const notBuilt = failure.kind === 'not_implemented';
  const accent = notBuilt ? colors.muted : failure.kind === 'unauthorized' || failure.kind === 'forbidden' ? colors.warning : colors.danger;
  return (
    <div style={{ border: `1px solid ${tint(accent, 0.45)}`, background: tint(accent, 0.07), borderRadius: '0.5rem', padding: '0.9rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <strong style={{ color: accent, fontSize: '0.95rem' }}>{failure.headline}</strong>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: accent, background: tint(accent, 0.15), borderRadius: 9999, padding: '0.05rem 0.5rem' }}>
          {failure.status ? `HTTP ${failure.status}` : 'no response'}
        </span>
      </div>
      <code style={{ display: 'block', fontSize: '0.75rem', color: colors.text, background: colors.headBg, padding: '0.3rem 0.45rem', borderRadius: 4, marginBottom: '0.5rem', wordBreak: 'break-all' }}>
        {failure.method} {failure.path}
      </code>
      <p style={{ margin: '0 0 0.35rem', fontSize: '0.82rem', color: colors.text, lineHeight: 1.45 }}>{failure.explanation}</p>
      {failure.detail ? (
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', color: colors.muted }}>
          Backend said: <code style={{ fontSize: '0.75rem' }}>{failure.detail}</code>
        </p>
      ) : null}
      <p style={{ margin: '0 0 0.6rem', fontSize: '0.75rem', color: colors.muted }}>
        No placeholder data is shown in its place — this console does not display figures it did not receive.
      </p>
      {onRetry ? <button onClick={onRetry} style={btn()}>Retry</button> : null}
    </div>
  );
}

/**
 * Loading / failure / empty / content, driven by a real failure object.
 * `emptyNote` explains WHY an empty result is legitimate (e.g. "no policies have
 * been sold yet"), so a genuine zero does not read as a broken screen.
 */
export function LiveState({ loading, failure, empty, emptyTitle = 'Nothing to show yet', emptyNote, onRetry, children }: PropsWithChildren<{
  loading: boolean;
  failure: EndpointFailure | null;
  empty: boolean;
  emptyTitle?: string;
  emptyNote?: string;
  onRetry?: () => void;
}>) {
  if (loading) return <p style={{ color: colors.muted, fontSize: '0.9rem' }}>Loading from the live API…</p>;
  if (failure) return <EndpointErrorCard failure={failure} onRetry={onRetry} />;
  if (empty) {
    return (
      <div style={{ border: `1px dashed ${colors.border}`, borderRadius: '0.5rem', padding: '1.5rem 1rem', textAlign: 'center' }}>
        <div style={{ fontWeight: 700, color: colors.text, marginBottom: '0.3rem' }}>{emptyTitle}</div>
        {emptyNote ? <div style={{ color: colors.muted, fontSize: '0.82rem', maxWidth: 560, margin: '0 auto', lineHeight: 1.5 }}>{emptyNote}</div> : null}
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * A KPI whose value may legitimately be absent. `value` of null renders
 * "not reported" rather than a zero — the distinction matters when the number
 * is money.
 */
export function MetricTile({ label: lbl, value, sub, accent, hint }: { label: string; value: string | null; sub?: string | null; accent?: string; hint?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.85rem 1rem', background: colors.card }} title={hint}>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{lbl}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: accent ?? colors.text }}>
        {value === null ? <NotReported /> : value}
      </div>
      {sub ? <div style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.15rem' }}>{sub}</div> : null}
    </div>
  );
}

/**
 * Server-side pager.
 *
 * `total` is nullable and `hasMore` comes from the API, not from arithmetic on
 * the page length. A pager that computes "page 3 of 7" from a total it never
 * received will confidently hide rows once the guess is wrong, so when the API
 * does not report a total this simply does not show one.
 */
export function Pager({ page, hasMore, onChange, count, total }: { page: number; hasMore: boolean; onChange: (p: number) => void; count: number; total: number | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
      <button style={{ ...btn(), opacity: page <= 1 ? 0.5 : 1 }} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Previous
      </button>
      <span style={{ fontSize: '0.8rem', color: colors.muted }}>
        Page {page} · {count.toLocaleString('en-NG')} row{count === 1 ? '' : 's'}
        {total !== null ? ` of ${total.toLocaleString('en-NG')}` : ''}
      </span>
      <button style={{ ...btn(), opacity: hasMore ? 1 : 0.5 }} disabled={!hasMore} onClick={() => onChange(page + 1)}>
        Next →
      </button>
    </div>
  );
}

/** Amber warning strip for a known, real gap (e.g. an unset webhook secret). */
export function WarningNote({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <div style={{ border: `1px solid ${tint(colors.warning, 0.5)}`, background: tint(colors.warning, 0.1), borderRadius: '0.5rem', padding: '0.65rem 0.85rem', fontSize: '0.8rem', marginBottom: '1rem', lineHeight: 1.5 }}>
      <strong style={{ display: 'block', color: colors.warning, marginBottom: '0.15rem' }}>{title}</strong>
      <span style={{ color: colors.text }}>{children}</span>
    </div>
  );
}

/**
 * Banner for a page whose endpoint is not part of the agreed internal contract.
 * The page still calls the endpoint (so it lights up the day it exists) but says
 * plainly that it is unbuilt rather than dressing a fixture up as live data.
 */
export function ContractGapNote({ endpoint }: { endpoint: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, background: colors.headBg, borderRadius: '0.5rem', padding: '0.65rem 0.85rem', fontSize: '0.8rem', marginBottom: '1rem', lineHeight: 1.5, color: colors.text }}>
      <strong>Not in the internal contract yet.</strong> This screen reads{' '}
      <code style={{ fontSize: '0.75rem' }}>{endpoint}</code>, which the agreed
      admin contract does not define. The call is made live on every load, so the page
      will start working the moment the endpoint exists. Until then it shows the real
      response — it does not fall back to sample data.
    </div>
  );
}

// Disclosure banner — underwriter + aggregator must be shown (PRD §13/§18).
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: `1px solid ${tint('#7c3aed', 0.4)}`, background: tint('#7c3aed', 0.08), color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Provider float — the prefunded distributor wallet
//
// MyCover settles binds against a balance Paymax funds in advance. When it
// empties, EVERY purchase fails at the provider, and any customer already
// debited is owed a refund. That makes the float the highest-consequence number
// in this module, so it gets a page-top alarm rather than a tile in a grid.
//
// Verified 2026-08-31 by a live purchase attempt on MyCover staging: a fully
// valid payload was rejected with "v2 Error: Insufficient wallet fund for
// purchase". MyCover's own /wallet/balance returns 403 for our credential, so
// the balance may be unreadable by machine — which is a THIRD state, distinct
// from funded and from empty, and is rendered as such.
// ═══════════════════════════════════════════════════════════════════════════

/** The float shape this module renders. Mirrors ProviderFloat structurally. */
export interface FloatView {
  provider?: string;
  state?: string;
  binding_paused?: boolean | null;
  consecutive_failures?: number | null;
  last_failure_at?: string | null;
  last_failure_text?: string | null;
  last_success_at?: string | null;
  last_topup_note?: string | null;
  last_reset_at?: string | null;
  updated_at?: string | null;
  balance_kobo?: number | null;
}

const FLOAT_UNREADABLE_NOTE =
  "MyCover's /wallet/balance returns 403 for our API key, so there is no balance to read. What is tracked instead is what the provider was observed to do on real bind attempts.";

/**
 * Page-top float alarm.
 *
 * Three states, three different messages, none of them silent:
 *   empty    — the breaker is tripped. Nothing can be sold. Loudest.
 *   critical — binds have been failing but the breaker has not tripped yet.
 *   unknown  — no float record. NOT treated as healthy: the last verified
 *              observation was an empty wallet, and that is stated with its date
 *              and its source rather than assumed away.
 * A healthy float renders nothing — an alarm that fires when all is well teaches
 * people to ignore it.
 */
export function FloatAlarm({ severity, reason, providerLabel = 'MyCover', failures }: {
  severity: 'unknown' | 'empty' | 'critical' | 'ok';
  reason?: string | null;
  providerLabel?: string;
  failures?: number | null;
}) {
  if (severity === 'ok') return null;
  const empty = severity === 'empty';
  const unknown = severity === 'unknown';
  const accent = empty ? colors.danger : colors.warning;
  return (
    <div
      style={{
        border: `2px solid ${accent}`,
        background: tint(accent, 0.1),
        borderRadius: '0.5rem',
        padding: '0.9rem 1.1rem',
        marginBottom: '1.25rem',
      }}
      role="alert"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        <strong style={{ color: accent, fontSize: '1rem' }}>
          {empty
            ? `${providerLabel} prefunded wallet is empty — binding is paused`
            : unknown
              ? `${providerLabel} float state is unknown`
              : `${providerLabel} binds are failing at the provider`}
        </strong>
      </div>
      <p style={{ margin: 0, fontSize: '0.85rem', color: colors.text, lineHeight: 1.55 }}>
        {empty ? (
          <>
            {reason ??
              "Every purchase debits a wallet Paymax funds in advance with the provider, and a bind was refused for insufficient funds. Binding is now paused so that no member is charged for cover that cannot be issued."}{' '}
            <strong>No policy can be sold until the wallet is topped up at the provider and the breaker is
            reset.</strong>
          </>
        ) : unknown ? (
          <>
            No float state was reported, so this console will not claim the wallet is funded.{' '}
            {FLOAT_UNREADABLE_NOTE} The last verified check, on 2026-08-31, found it empty: a live purchase
            with a fully valid payload was rejected with &ldquo;Insufficient wallet fund for purchase&rdquo;.
            Treat the float as unfunded until a state is actually reported here.
          </>
        ) : (
          <>
            {failures ? <><strong>{failures}</strong> consecutive bind failure{failures === 1 ? '' : 's'} recorded at the provider. </> : null}
            The breaker has not tripped yet, but a wallet that is emptying will stop every sale when it does.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Float detail panel — a breaker readout, not a balance readout.
 *
 * There is deliberately no "balance" tile filled with a zero. We cannot read the
 * balance, and inventing one is exactly what this console exists to stop; what
 * is shown is what the provider actually did on real bind attempts.
 */
export function FloatPanel({ float: f, severity, onReset }: {
  float: FloatView | null;
  severity: 'unknown' | 'empty' | 'critical' | 'ok';
  onReset?: () => void;
}) {
  const accent = severity === 'empty' ? colors.danger : severity === 'critical' ? colors.warning : severity === 'unknown' ? colors.muted : colors.success;
  if (!f) {
    return (
      <p style={{ color: colors.muted, fontSize: '0.85rem', margin: 0, lineHeight: 1.55 }}>
        No float state was reported for this rail. That is an absence of information, not a healthy
        reading. {FLOAT_UNREADABLE_NOTE}
      </p>
    );
  }
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem' }}>
        <MetricTile
          label="Binding"
          value={f.binding_paused === null || f.binding_paused === undefined ? null : f.binding_paused ? 'PAUSED' : 'Allowed'}
          sub={f.binding_paused ? 'no policy can be issued' : 'binds are being attempted'}
          accent={accent}
        />
        <MetricTile label="Breaker state" value={f.state ?? null} sub="as observed at the provider" accent={accent} />
        <MetricTile
          label="Consecutive failures"
          value={f.consecutive_failures === null || f.consecutive_failures === undefined ? null : f.consecutive_failures.toLocaleString('en-NG')}
          sub="binds refused in a row"
          accent={f.consecutive_failures ? colors.danger : undefined}
        />
        <MetricTile label="Last successful bind" value={f.last_success_at ? fmtDate(f.last_success_at) : null} />
        <MetricTile
          label="Last reset"
          value={f.last_reset_at ? fmtDate(f.last_reset_at) : null}
          sub={f.last_topup_note ? `note: ${f.last_topup_note}` : 'after a top-up'}
        />
      </div>
      {f.last_failure_text ? (
        <p style={{ marginTop: '0.8rem', marginBottom: 0, fontSize: '0.8rem', color: colors.danger }}>
          Provider said: <code style={{ fontSize: '0.75rem' }}>{f.last_failure_text}</code>
          {f.last_failure_at ? <span style={{ color: colors.muted }}> ({timeAgo(f.last_failure_at)})</span> : null}
        </p>
      ) : null}
      <p style={{ marginTop: '0.8rem', marginBottom: 0, fontSize: '0.8rem', color: colors.muted, lineHeight: 1.55 }}>
        <strong>There is no balance figure here on purpose.</strong> {FLOAT_UNREADABLE_NOTE} A zero would be a
        number we made up, and the one thing worse than not knowing the float is believing a figure for it.
      </p>
      {onReset ? (
        <button onClick={onReset} style={{ ...btn(), marginTop: '0.8rem' }}>
          Reset breaker after funding…
        </button>
      ) : null}
    </>
  );
}

/**
 * A console surface whose backend endpoint does not exist yet.
 *
 * Nine screens in this module (premiums, refunds, routing, schema, sweeps,
 * reports, consent-audit, provider events, webhook deliveries) shipped as fully
 * populated tables driven entirely by fixtures. They looked like the most
 * finished part of the console and were the least real part of it.
 *
 * Rather than delete the routes — the surfaces are wanted, and the navigation
 * links to them — each one now:
 *   1. states plainly that the endpoint is unbuilt,
 *   2. calls it live anyway on every load, so the page starts working by itself
 *      the moment the backend adds a handler,
 *   3. renders the real response, whatever it is: the failure if it failed, or
 *      the raw payload if it succeeded before this page has a bespoke view for
 *      it. Raw JSON is ugly; invented rows are dishonest.
 *
 * `requires` documents what the screen needs from the backend, so the gap is
 * legible to whoever builds it rather than living only in a ticket.
 */
export function UnbuiltSurface({ endpoint, purpose, requires, note, probeFn }: {
  endpoint: string;
  purpose: string;
  requires: string[];
  note?: ReactNode;
  probeFn: () => Promise<unknown>;
}) {
  const [payload, setPayload] = useState<unknown>(null);
  const [failure, setFailure] = useState<EndpointFailure | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setPayload(await probeFn());
    } catch (e) {
      setPayload(null);
      setFailure(toFailure(e));
    } finally {
      setLoading(false);
    }
  }, [probeFn]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <ContractGapNote endpoint={endpoint} />
      {note}
      <Card title="What this screen is for">
        <p style={{ fontSize: '0.88rem', color: colors.text, lineHeight: 1.6, marginTop: 0 }}>{purpose}</p>
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600, marginBottom: '0.4rem' }}>
          Needs from the backend
        </div>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.84rem', color: colors.text, lineHeight: 1.6 }}>
          {requires.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Card>

      <Card title="Live response" right={<button onClick={load} style={btn()}>Probe again</button>}>
        {loading ? (
          <p style={{ color: colors.muted, fontSize: '0.9rem' }}>Calling the endpoint…</p>
        ) : failure ? (
          <EndpointErrorCard failure={failure} onRetry={load} />
        ) : (
          <>
            <p style={{ fontSize: '0.82rem', color: colors.success, marginTop: 0 }}>
              <strong>The endpoint answered.</strong> Its payload is shown verbatim below. This screen does not
              have a purpose-built view for it yet — raw is honest, and nothing here is reshaped or filled in.
            </p>
            <pre style={{ background: colors.headBg, borderRadius: '0.4rem', padding: '0.75rem', fontSize: '0.75rem', overflowX: 'auto', maxHeight: 480, margin: 0 }}>
              {JSON.stringify(payload, null, 2)}
            </pre>
          </>
        )}
      </Card>
    </>
  );
}

export function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const past = diff >= 0;
  const h = Math.floor(Math.abs(diff) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}

export function fmtDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
}
