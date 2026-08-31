'use client';

import Link from 'next/link';
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
