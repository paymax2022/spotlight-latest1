'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

// Shared presentational helpers for the Paymax HEALTH ops consoles — pharmacy,
// laboratory and veterinary admin all import from this single file via relative
// path. Matches the Connect / Insurance / Stays / Savings / Events admin
// light-card inline-style convention (copied from events/_ui.tsx).
// Lab + Vet admin (added later) reuse the same primitives + their own *Tabs.

export const card = (): CSSProperties => ({ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', background: '#fff' });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: '1px solid #340075', background: '#340075', color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: '#374151', fontSize: '0.85rem', borderTop: '1px solid #f3f4f6', verticalAlign: 'top' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: '#fff', cursor: 'pointer' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // success / terminal-good
  active: { fg: '#15803d', bg: '#dcfce7' }, approved: { fg: '#15803d', bg: '#dcfce7' },
  verified: { fg: '#15803d', bg: '#dcfce7' }, completed: { fg: '#15803d', bg: '#dcfce7' },
  released: { fg: '#15803d', bg: '#dcfce7' }, fulfilled: { fg: '#15803d', bg: '#dcfce7' },
  resolved: { fg: '#15803d', bg: '#dcfce7' }, paid: { fg: '#15803d', bg: '#dcfce7' },
  delivered: { fg: '#15803d', bg: '#dcfce7' }, collected: { fg: '#15803d', bg: '#dcfce7' },
  dispensed: { fg: '#15803d', bg: '#dcfce7' }, on_track: { fg: '#15803d', bg: '#dcfce7' },
  confirmed: { fg: '#15803d', bg: '#dcfce7' }, ok: { fg: '#15803d', bg: '#dcfce7' },
  // pending / warn
  pending: { fg: '#9a3412', bg: '#ffedd5' }, submitted: { fg: '#9a3412', bg: '#ffedd5' },
  needs_info: { fg: '#9a3412', bg: '#ffedd5' }, under_review: { fg: '#9a3412', bg: '#ffedd5' },
  verifying: { fg: '#9a3412', bg: '#ffedd5' }, rx_pending_verification: { fg: '#9a3412', bg: '#ffedd5' },
  kyc_hold: { fg: '#9a3412', bg: '#ffedd5' }, ready_for_pickup: { fg: '#9a3412', bg: '#ffedd5' },
  flagged: { fg: '#9a3412', bg: '#ffedd5' }, scheduled: { fg: '#9a3412', bg: '#ffedd5' },
  // in-progress / info (blue)
  investigating: { fg: '#1d4ed8', bg: '#dbeafe' }, processing: { fg: '#1d4ed8', bg: '#dbeafe' },
  open: { fg: '#1d4ed8', bg: '#dbeafe' }, in_delivery: { fg: '#1d4ed8', bg: '#dbeafe' },
  issued: { fg: '#1d4ed8', bg: '#dbeafe' }, sent_to_pharmacy: { fg: '#1d4ed8', bg: '#dbeafe' },
  created: { fg: '#1d4ed8', bg: '#dbeafe' }, logged: { fg: '#1d4ed8', bg: '#dbeafe' },
  delivery: { fg: '#1d4ed8', bg: '#dbeafe' }, normal: { fg: '#1d4ed8', bg: '#dbeafe' },
  // neutral / muted
  draft: { fg: '#6b7280', bg: '#f3f4f6' }, expired: { fg: '#6b7280', bg: '#f3f4f6' },
  closed: { fg: '#6b7280', bg: '#f3f4f6' }, ignored: { fg: '#6b7280', bg: '#f3f4f6' },
  pickup: { fg: '#6b7280', bg: '#f3f4f6' }, low: { fg: '#6b7280', bg: '#f3f4f6' },
  otc: { fg: '#6b7280', bg: '#f3f4f6' },
  // danger / terminal-bad
  rejected: { fg: '#b91c1c', bg: '#fee2e2' }, failed: { fg: '#b91c1c', bg: '#fee2e2' },
  blocked: { fg: '#b91c1c', bg: '#fee2e2' }, suspended: { fg: '#b91c1c', bg: '#fee2e2' },
  high: { fg: '#b91c1c', bg: '#fee2e2' }, critical: { fg: '#b91c1c', bg: '#fee2e2' },
  breached: { fg: '#b91c1c', bg: '#fee2e2' }, controlled: { fg: '#b91c1c', bg: '#fee2e2' },
  invalid: { fg: '#b91c1c', bg: '#fee2e2' }, pom: { fg: '#b91c1c', bg: '#fee2e2' },
  // refund / reversal (purple)
  refunded: { fg: '#7c3aed', bg: '#ede9fe' }, reversed: { fg: '#7c3aed', bg: '#ede9fe' },
  cancelled: { fg: '#7c3aed', bg: '#ede9fe' }, held: { fg: '#7c3aed', bg: '#ede9fe' },
  // severity / grade
  medium: { fg: '#9a3412', bg: '#ffedd5' },
  // KYC tiers
  tier0: { fg: '#b91c1c', bg: '#fee2e2' }, tier1: { fg: '#9a3412', bg: '#ffedd5' },
  tier2: { fg: '#1d4ed8', bg: '#dbeafe' }, tier3: { fg: '#15803d', bg: '#dcfce7' },
  // activity kinds
  pcn_approved: { fg: '#15803d', bg: '#dcfce7' }, rx_verified: { fg: '#15803d', bg: '#dcfce7' },
  catalog_rejected: { fg: '#b91c1c', bg: '#fee2e2' }, order_dispensed: { fg: '#1d4ed8', bg: '#dbeafe' },
  recall_issued: { fg: '#9a3412', bg: '#ffedd5' }, payout_held: { fg: '#9a3412', bg: '#ffedd5' },
  controlled_blocked: { fg: '#b91c1c', bg: '#fee2e2' },
  // ── Lab vertical (HEALTH-BUILD Phase 2 ADM) — additive status colours ──
  // chain-of-custody (HL-6) — note: `breached` already defined above (danger group)
  in_custody: { fg: '#1d4ed8', bg: '#dbeafe' }, handed_over: { fg: '#1d4ed8', bg: '#dbeafe' },
  accessioned: { fg: '#15803d', bg: '#dcfce7' },
  recollect_required: { fg: '#9a3412', bg: '#ffedd5' },
  // results audit / release (HL-8) — note: `released` already defined above (success group)
  result_ready: { fg: '#9a3412', bg: '#ffedd5' },
  amended: { fg: '#7c3aed', bg: '#ede9fe' }, abnormal: { fg: '#9a3412', bg: '#ffedd5' },
  // critical-result escalation (HL-7)
  escalated: { fg: '#b91c1c', bg: '#fee2e2' }, acknowledged: { fg: '#1d4ed8', bg: '#dbeafe' },
  // lab activity kinds
  mlscn_approved: { fg: '#15803d', bg: '#dcfce7' }, custody_breach: { fg: '#b91c1c', bg: '#fee2e2' },
  result_released: { fg: '#15803d', bg: '#dcfce7' }, critical_escalated: { fg: '#b91c1c', bg: '#fee2e2' },
  catalog_governed: { fg: '#9a3412', bg: '#ffedd5' },
  // ── Vet vertical (HEALTH-BUILD Phase 3 ADM) — additive status colours ──
  // Appointment lifecycle (REQUESTED→ACCEPTED→CONFIRMED→IN_PROGRESS→COMPLETED; →CANCELLED|NO_SHOW).
  // note: confirmed/completed/in_progress/cancelled/held/released/refunded already defined above.
  requested: { fg: '#1d4ed8', bg: '#dbeafe' }, accepted: { fg: '#1d4ed8', bg: '#dbeafe' },
  rescheduled: { fg: '#9a3412', bg: '#ffedd5' }, no_show: { fg: '#b91c1c', bg: '#fee2e2' },
  // appointment / service mode
  tele: { fg: '#1d4ed8', bg: '#dbeafe' }, home: { fg: '#7c3aed', bg: '#ede9fe' }, clinic: { fg: '#15803d', bg: '#dcfce7' },
  // emergency (HL-11)
  emergency: { fg: '#b91c1c', bg: '#fee2e2' }, sos: { fg: '#b91c1c', bg: '#fee2e2' },
  // vet activity kinds
  vcn_approved: { fg: '#15803d', bg: '#dcfce7' }, appointment_completed: { fg: '#1d4ed8', bg: '#dbeafe' },
  eprescription_issued: { fg: '#1d4ed8', bg: '#dbeafe' }, content_moderated: { fg: '#9a3412', bg: '#ffedd5' },
  sos_routed: { fg: '#b91c1c', bg: '#fee2e2' },
  // ── Triage / AI Symptom Checker (clinical console) — additive status colours ──
  // TriageSession states
  started: { fg: '#6b7280', bg: '#f3f4f6' }, consented: { fg: '#1d4ed8', bg: '#dbeafe' },
  interviewing: { fg: '#1d4ed8', bg: '#dbeafe' }, red_flag_detected: { fg: '#b91c1c', bg: '#fee2e2' },
  assessed: { fg: '#1d4ed8', bg: '#dbeafe' }, disposition_given: { fg: '#15803d', bg: '#dcfce7' },
  referred: { fg: '#15803d', bg: '#dcfce7' }, abandoned: { fg: '#6b7280', bg: '#f3f4f6' },
  // 5-level disposition (emergency-sensitivity-first; never a diagnosis, SC-1)
  emergency_ambulance: { fg: '#b91c1c', bg: '#fee2e2' }, emergency_urgent: { fg: '#b91c1c', bg: '#fee2e2' },
  consult_24h: { fg: '#9a3412', bg: '#ffedd5' }, consult_routine: { fg: '#1d4ed8', bg: '#dbeafe' },
  self_care: { fg: '#15803d', bg: '#dcfce7' },
  // EscalationCase states (raised/notified already share groups; add explicit)
  raised: { fg: '#b91c1c', bg: '#fee2e2' }, notified: { fg: '#9a3412', bg: '#ffedd5' },
  // Governance lifecycle (DRAFT→CLINICAL_REVIEW→APPROVED→PUBLISHED→DEPRECATED; SC-6)
  clinical_review: { fg: '#9a3412', bg: '#ffedd5' }, published: { fg: '#15803d', bg: '#dcfce7' },
  deprecated: { fg: '#6b7280', bg: '#f3f4f6' },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? { fg: '#374151', bg: '#f3f4f6' };
  return <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: c.fg, background: c.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{lbl ?? status.replace(/_/g, ' ')}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{title}</h1>
        {subtitle ? <p style={{ color: '#6b7280', margin: '0.25rem 0 0', fontSize: '0.85rem', maxWidth: 820 }}>{subtitle}</p> : null}
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
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.85rem 1rem', background: '#fff' }}>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>{lbl}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: accent ?? '#111827' }}>{value}</div>
      {sub ? <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.15rem' }}>{sub}</div> : null}
    </div>
  );
}

type Tab = { href: string; label: string; key: string };

function Tabs({ active, tabs }: { active: string; tabs: Tab[] }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#340075' : '#f3f4f6' }}>{t.label}</Link>
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
