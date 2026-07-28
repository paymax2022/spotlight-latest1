'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

// ── Shared presentational helpers for the Spotlight ACADEMY admin console ─────
// Local mirror of app/admin/health/_ui.tsx (same light-card inline-style
// convention, #340075 brand accent). Every Academy page imports these primitives
// + AcademyTabs from this single file. Kept self-contained so the Academy slice
// renders without touching the Health helpers.

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
  published: { fg: '#15803d', bg: '#dcfce7' }, funded: { fg: '#15803d', bg: '#dcfce7' },
  paid: { fg: '#15803d', bg: '#dcfce7' }, completed: { fg: '#15803d', bg: '#dcfce7' },
  allocated: { fg: '#15803d', bg: '#dcfce7' }, live: { fg: '#15803d', bg: '#dcfce7' },
  reconciled: { fg: '#15803d', bg: '#dcfce7' }, disbursed: { fg: '#15803d', bg: '#dcfce7' },
  collected: { fg: '#15803d', bg: '#dcfce7' }, released: { fg: '#15803d', bg: '#dcfce7' },
  core: { fg: '#15803d', bg: '#dcfce7' },
  // pending / warn (amber)
  pending: { fg: '#9a3412', bg: '#ffedd5' }, in_review: { fg: '#9a3412', bg: '#ffedd5' },
  under_review: { fg: '#9a3412', bg: '#ffedd5' }, needs_info: { fg: '#9a3412', bg: '#ffedd5' },
  scheduled: { fg: '#9a3412', bg: '#ffedd5' }, low_balance: { fg: '#9a3412', bg: '#ffedd5' },
  review: { fg: '#9a3412', bg: '#ffedd5' }, in_translation: { fg: '#9a3412', bg: '#ffedd5' },
  funding: { fg: '#9a3412', bg: '#ffedd5' }, fee_due: { fg: '#9a3412', bg: '#ffedd5' },
  onboarding: { fg: '#9a3412', bg: '#ffedd5' }, frequent: { fg: '#9a3412', bg: '#ffedd5' },
  packaged: { fg: '#9a3412', bg: '#ffedd5' }, matured: { fg: '#9a3412', bg: '#ffedd5' },
  // in-progress / info (blue)
  draft: { fg: '#1d4ed8', bg: '#dbeafe' }, authoring: { fg: '#1d4ed8', bg: '#dbeafe' },
  open: { fg: '#1d4ed8', bg: '#dbeafe' }, upcoming: { fg: '#1d4ed8', bg: '#dbeafe' },
  generated: { fg: '#1d4ed8', bg: '#dbeafe' }, partial: { fg: '#1d4ed8', bg: '#dbeafe' },
  // neutral / muted
  archived: { fg: '#6b7280', bg: '#f3f4f6' }, legacy: { fg: '#6b7280', bg: '#f3f4f6' },
  closed: { fg: '#6b7280', bg: '#f3f4f6' }, ended: { fg: '#6b7280', bg: '#f3f4f6' },
  inactive: { fg: '#6b7280', bg: '#f3f4f6' }, depleted: { fg: '#6b7280', bg: '#f3f4f6' },
  // danger / terminal-bad
  rejected: { fg: '#b91c1c', bg: '#fee2e2' }, failed: { fg: '#b91c1c', bg: '#fee2e2' },
  suspended: { fg: '#b91c1c', bg: '#fee2e2' }, blocked: { fg: '#b91c1c', bg: '#fee2e2' },
  unfunded: { fg: '#b91c1c', bg: '#fee2e2' }, expired: { fg: '#b91c1c', bg: '#fee2e2' },
  duplicate: { fg: '#b91c1c', bg: '#fee2e2' },
  // refund / reversal (purple)
  refunded: { fg: '#7c3aed', bg: '#ede9fe' }, reversed: { fg: '#7c3aed', bg: '#ede9fe' },
  redeemed: { fg: '#7c3aed', bg: '#ede9fe' },
  // difficulty
  easy: { fg: '#15803d', bg: '#dcfce7' }, medium: { fg: '#9a3412', bg: '#ffedd5' },
  hard: { fg: '#b91c1c', bg: '#fee2e2' },
  // exam codes
  cce: { fg: '#1d4ed8', bg: '#dbeafe' }, bece: { fg: '#1d4ed8', bg: '#dbeafe' },
  wassce: { fg: '#1d4ed8', bg: '#dbeafe' }, neco: { fg: '#1d4ed8', bg: '#dbeafe' },
  utme: { fg: '#1d4ed8', bg: '#dbeafe' }, nabteb: { fg: '#1d4ed8', bg: '#dbeafe' },
  // ── Phase 3 — credentials / live / moderation ──
  issued: { fg: '#15803d', bg: '#dcfce7' }, routed: { fg: '#15803d', bg: '#dcfce7' },
  ready: { fg: '#15803d', bg: '#dcfce7' }, eligible: { fg: '#15803d', bg: '#dcfce7' },
  revoked: { fg: '#b91c1c', bg: '#fee2e2' }, retired: { fg: '#6b7280', bg: '#f3f4f6' },
  paused: { fg: '#9a3412', bg: '#ffedd5' }, processing: { fg: '#9a3412', bg: '#ffedd5' },
  triaged: { fg: '#9a3412', bg: '#ffedd5' }, submitted: { fg: '#1d4ed8', bg: '#dbeafe' },
  none: { fg: '#6b7280', bg: '#f3f4f6' }, cancelled: { fg: '#6b7280', bg: '#f3f4f6' },
  actioned: { fg: '#15803d', bg: '#dcfce7' }, dismissed: { fg: '#6b7280', bg: '#f3f4f6' },
  escalated: { fg: '#b91c1c', bg: '#fee2e2' }, hide: { fg: '#9a3412', bg: '#ffedd5' },
  warn: { fg: '#9a3412', bg: '#ffedd5' }, ban: { fg: '#b91c1c', bg: '#fee2e2' },
  // severity
  low: { fg: '#15803d', bg: '#dcfce7' }, high: { fg: '#9a3412', bg: '#ffedd5' },
  critical: { fg: '#b91c1c', bg: '#fee2e2' },
  // ── Phase 4 — schools / tutor ops / BI ──
  trial: { fg: '#1d4ed8', bg: '#dbeafe' }, requested: { fg: '#1d4ed8', bg: '#dbeafe' },
  investigating: { fg: '#9a3412', bg: '#ffedd5' }, overdue: { fg: '#b91c1c', bg: '#fee2e2' },
  resolved: { fg: '#15803d', bg: '#dcfce7' }, void: { fg: '#6b7280', bg: '#f3f4f6' },
  applied: { fg: '#1d4ed8', bg: '#dbeafe' }, verified: { fg: '#15803d', bg: '#dcfce7' },
  // activity kinds
  pool_funded: { fg: '#15803d', bg: '#dcfce7' }, reward_redeemed: { fg: '#7c3aed', bg: '#ede9fe' },
  item_approved: { fg: '#15803d', bg: '#dcfce7' }, item_rejected: { fg: '#b91c1c', bg: '#fee2e2' },
  cards_generated: { fg: '#1d4ed8', bg: '#dbeafe' }, plan_published: { fg: '#15803d', bg: '#dcfce7' },
  badge_earned: { fg: '#15803d', bg: '#dcfce7' }, exam_opened: { fg: '#1d4ed8', bg: '#dbeafe' },
  campaign_launched: { fg: '#1d4ed8', bg: '#dbeafe' },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status.toLowerCase()] ?? { fg: '#374151', bg: '#f3f4f6' };
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

// Academy admin tab strip — links the whole Phase 0+1 console slice.
export function AcademyTabs({ active }: { active: string }) {
  return <Tabs active={active} tabs={[
    { href: '/admin/academy', label: 'Overview', key: 'overview' },
    { href: '/admin/academy/curriculum', label: 'Curriculum', key: 'curriculum' },
    { href: '/admin/academy/content', label: 'Content', key: 'content' },
    { href: '/admin/academy/content-production', label: 'Production', key: 'content-production' },
    { href: '/admin/academy/bundles', label: 'Bundles', key: 'bundles' },
    { href: '/admin/academy/question-bank', label: 'Question bank', key: 'question-bank' },
    { href: '/admin/academy/exams', label: 'Exams', key: 'exams' },
    { href: '/admin/academy/gamification', label: 'Gamification', key: 'gamification' },
    { href: '/admin/academy/rewards', label: 'Rewards', key: 'rewards' },
    { href: '/admin/academy/notifications', label: 'Notifications', key: 'notifications' },
    { href: '/admin/academy/commerce', label: 'Commerce', key: 'commerce' },
    { href: '/admin/academy/edupay', label: 'EduPay', key: 'edupay' },
    { href: '/admin/academy/sponsors', label: 'Sponsors', key: 'sponsors' },
    { href: '/admin/academy/credentials', label: 'Credentials', key: 'credentials' },
    { href: '/admin/academy/live', label: 'Live & Events', key: 'live' },
    { href: '/admin/academy/moderation', label: 'Moderation', key: 'moderation' },
    { href: '/admin/academy/schools', label: 'Schools', key: 'schools' },
    { href: '/admin/academy/tutors', label: 'Tutor Ops', key: 'tutors' },
    { href: '/admin/academy/analytics', label: 'Analytics & BI', key: 'analytics' },
  ]} />;
}

// Standard loading / empty / error placeholders for every list page.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: '#6b7280' }}>Loading…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;
  if (empty) return <p style={{ color: '#6b7280' }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure banner — surfaces the Academy invariants admins must respect.
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
}

// Inline note that a state-change action is recorded to the immutable audit log.
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

// Horizontal CSS bar (dependency-free chart primitive).
export function Bar({ value, max, color = '#340075', labelLeft, labelRight }: { value: number; max: number; color?: string; labelLeft?: string; labelRight?: string }) {
  const w = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      {labelLeft ? <span style={{ width: 110, flexShrink: 0, fontSize: '0.72rem', color: '#9ca3af' }}>{labelLeft}</span> : null}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <div style={{ height: 10, width: `${w}%`, minWidth: 2, background: color, borderRadius: 2 }} />
        {labelRight ? <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{labelRight}</span> : null}
      </div>
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

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// All money is in kobo internally; render in ₦.
export function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
