'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational helpers for the Paymax HEALTH ops consoles — pharmacy,
// laboratory and veterinary admin all import from this single file via relative
// path. Matches the Connect / Insurance / Stays / Savings / Events admin
// light-card inline-style convention (copied from events/_ui.tsx).
// Lab + Vet admin (added later) reuse the same primitives + their own *Tabs.

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card, boxShadow: '0 1px 3px rgba(47,43,61,0.06)' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, color: colors.text, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.primary}`, background: colors.primary, color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.danger}`, background: colors.card, color: colors.danger, fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.border}`, verticalAlign: 'top' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box', background: colors.card, color: colors.text });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: colors.card, cursor: 'pointer' });

const STATUS_COLORS: Record<string, string> = {
  // success / terminal-good
  active: colors.success, approved: colors.success,
  verified: colors.success, completed: colors.success,
  released: colors.success, fulfilled: colors.success,
  resolved: colors.success, paid: colors.success,
  delivered: colors.success, collected: colors.success,
  dispensed: colors.success, on_track: colors.success,
  confirmed: colors.success, ok: colors.success,
  // pending / warn
  pending: colors.warning, submitted: colors.warning,
  needs_info: colors.warning, under_review: colors.warning,
  verifying: colors.warning, rx_pending_verification: colors.warning,
  kyc_hold: colors.warning, ready_for_pickup: colors.warning,
  flagged: colors.warning, scheduled: colors.warning,
  // in-progress / info (blue)
  investigating: colors.info, processing: colors.info,
  open: colors.info, in_delivery: colors.info,
  issued: colors.info, sent_to_pharmacy: colors.info,
  created: colors.info, logged: colors.info,
  delivery: colors.info, normal: colors.info,
  // neutral / muted
  draft: colors.secondary, expired: colors.secondary,
  closed: colors.secondary, ignored: colors.secondary,
  pickup: colors.secondary, low: colors.secondary,
  otc: colors.secondary,
  // danger / terminal-bad
  rejected: colors.danger, failed: colors.danger,
  blocked: colors.danger, suspended: colors.danger,
  high: colors.danger, critical: colors.danger,
  breached: colors.danger, controlled: colors.danger,
  invalid: colors.danger, pom: colors.danger,
  // refund / reversal (purple)
  refunded: '#7c3aed', reversed: '#7c3aed',
  cancelled: '#7c3aed', held: '#7c3aed',
  // severity / grade
  medium: colors.warning,
  // KYC tiers
  tier0: colors.danger, tier1: colors.warning,
  tier2: colors.info, tier3: colors.success,
  // activity kinds
  pcn_approved: colors.success, rx_verified: colors.success,
  catalog_rejected: colors.danger, order_dispensed: colors.info,
  recall_issued: colors.warning, payout_held: colors.warning,
  controlled_blocked: colors.danger,
  // ── Lab vertical (HEALTH-BUILD Phase 2 ADM) — additive status colours ──
  // chain-of-custody (HL-6) — note: `breached` already defined above (danger group)
  in_custody: colors.info, handed_over: colors.info,
  accessioned: colors.success,
  recollect_required: colors.warning,
  // results audit / release (HL-8) — note: `released` already defined above (success group)
  result_ready: colors.warning,
  amended: '#7c3aed', abnormal: colors.warning,
  // critical-result escalation (HL-7)
  escalated: colors.danger, acknowledged: colors.info,
  // lab activity kinds
  mlscn_approved: colors.success, custody_breach: colors.danger,
  result_released: colors.success, critical_escalated: colors.danger,
  catalog_governed: colors.warning,
  // ── Vet vertical (HEALTH-BUILD Phase 3 ADM) — additive status colours ──
  // Appointment lifecycle (REQUESTED→ACCEPTED→CONFIRMED→IN_PROGRESS→COMPLETED; →CANCELLED|NO_SHOW).
  // note: confirmed/completed/in_progress/cancelled/held/released/refunded already defined above.
  requested: colors.info, accepted: colors.info,
  rescheduled: colors.warning, no_show: colors.danger,
  // appointment / service mode
  tele: colors.info, home: '#7c3aed', clinic: colors.success,
  // emergency (HL-11)
  emergency: colors.danger, sos: colors.danger,
  // vet activity kinds
  vcn_approved: colors.success, appointment_completed: colors.info,
  eprescription_issued: colors.info, content_moderated: colors.warning,
  sos_routed: colors.danger,
  // ── Triage / AI Symptom Checker (clinical console) — additive status colours ──
  // TriageSession states
  started: colors.secondary, consented: colors.info,
  interviewing: colors.info, red_flag_detected: colors.danger,
  assessed: colors.info, disposition_given: colors.success,
  referred: colors.success, abandoned: colors.secondary,
  // 5-level disposition (emergency-sensitivity-first; never a diagnosis, SC-1)
  emergency_ambulance: colors.danger, emergency_urgent: colors.danger,
  consult_24h: colors.warning, consult_routine: colors.info,
  self_care: colors.success,
  // EscalationCase states (raised/notified already share groups; add explicit)
  raised: colors.danger, notified: colors.warning,
  // Governance lifecycle (DRAFT→CLINICAL_REVIEW→APPROVED→PUBLISHED→DEPRECATED; SC-6)
  clinical_review: colors.warning, published: colors.success,
  deprecated: colors.secondary,
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? colors.secondary;
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c, background: tint(c, 0.12), textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{lbl ?? status.replace(/_/g, ' ')}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: colors.text }}>{title}</h1>
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
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: colors.text }}>{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Kpi({ label: lbl, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.85rem 1rem', background: colors.card, boxShadow: '0 1px 3px rgba(47,43,61,0.06)' }}>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{lbl}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.15rem' }}>{sub}</div> : null}
    </div>
  );
}

type Tab = { href: string; label: string; key: string };

function Tabs({ active, tabs }: { active: string; tabs: Tab[] }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.bg }}>{t.label}</Link>
      ))}
    </div>
  );
}

export function PharmacyTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/health/pharmacy/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/health/pharmacy/pcn-audit', label: 'PCN audit', key: 'pcn-audit' },
    { href: '/admin/health/pharmacy/catalog', label: 'Catalog', key: 'catalog' },
    { href: '/admin/health/pharmacy/rx-audit', label: 'Rx audit', key: 'rx-audit' },
    { href: '/admin/health/pharmacy/orders', label: 'Orders', key: 'orders' },
    { href: '/admin/health/pharmacy/recall', label: 'Recall', key: 'recall' },
    { href: '/admin/health/pharmacy/payouts', label: 'Payouts', key: 'payouts' },
    { href: '/admin/health/pharmacy/reporting', label: 'Reporting', key: 'reporting' },
  ]} />;
}

// Lab admin tab strip (HEALTH-BUILD Phase 2 ADM) — additive; mirrors PharmacyTabs.
export function LabTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/health/lab/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/health/lab/mlscn-audit', label: 'MLSCN audit', key: 'mlscn-audit' },
    { href: '/admin/health/lab/catalog', label: 'Catalog', key: 'catalog' },
    { href: '/admin/health/lab/custody', label: 'Custody', key: 'custody' },
    { href: '/admin/health/lab/results-audit', label: 'Results audit', key: 'results-audit' },
    { href: '/admin/health/lab/escalation', label: 'Escalation', key: 'escalation' },
    { href: '/admin/health/lab/phlebotomists', label: 'Phlebotomists', key: 'phlebotomists' },
    { href: '/admin/health/lab/payouts', label: 'Payouts', key: 'payouts' },
    { href: '/admin/health/lab/reporting', label: 'Reporting', key: 'reporting' },
  ]} />;
}

// Vet admin tab strip (HEALTH-BUILD Phase 3 ADM) — additive; mirrors Lab/Pharmacy tabs.
export function VetTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/health/vet/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/health/vet/vcn-audit', label: 'VCN audit', key: 'vcn-audit' },
    { href: '/admin/health/vet/verification', label: 'Verification', key: 'verification' },
    { href: '/admin/health/vet/services', label: 'Services', key: 'services' },
    { href: '/admin/health/vet/appointments', label: 'Appointments', key: 'appointments' },
    { href: '/admin/health/vet/eprescription-audit', label: 'e-Rx audit', key: 'eprescription-audit' },
    { href: '/admin/health/vet/payouts', label: 'Payouts', key: 'payouts' },
    { href: '/admin/health/vet/moderation', label: 'Moderation', key: 'moderation' },
    { href: '/admin/health/vet/reporting', label: 'Reporting', key: 'reporting' },
  ]} />;
}

// Triage / AI Symptom Checker admin tab strip — additive; mirrors Vet/Lab tabs.
export function TriageTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/health/triage', label: 'Sessions', key: 'sessions' },
    { href: '/admin/health/triage/escalations', label: 'Escalations', key: 'escalations' },
    { href: '/admin/health/triage/content', label: 'Clinical content', key: 'content' },
    { href: '/admin/health/triage/red-flag-rules', label: 'Red-flag rules', key: 'red-flag-rules' },
    { href: '/admin/health/triage/validation', label: 'Validation', key: 'validation' },
  ]} />;
}

// Standard loading / empty / error placeholders for every list page.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: '#6b7280' }}>Loading…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
  if (empty) return <p style={{ color: '#6b7280' }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure banner — surfaces the HEALTH invariants (HL-1..HL-12) admins must respect.
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
}

// Inline note that a state-change action is recorded to the immutable audit log (HL-12).
export function AuditNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: '0.375rem', padding: '0.4rem 0.6rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
      <span aria-hidden style={{ fontWeight: 700 }}>●</span>
      <span>{children}</span>
    </div>
  );
}

// Inline filter bar wrapper.
export function FilterBar({ children }: PropsWithChildren) {
  return <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>{children}</div>;
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

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
