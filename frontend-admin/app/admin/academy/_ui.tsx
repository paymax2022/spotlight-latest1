'use client';

import Link from 'next/link';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { colors, tint } from '@/components/ui/vuexy';

// ── Shared presentational helpers for the Spotlight ACADEMY admin console ─────
// Local mirror of app/admin/health/_ui.tsx (same light-card inline-style
// convention, #340075 brand accent). Every Academy page imports these primitives
// + AcademyTabs from this single file. Kept self-contained so the Academy slice
// renders without touching the Health helpers.

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.primary}`, background: colors.primary, color: '#fff', fontWeight: 600 });
export const btnDanger = (): CSSProperties => ({ ...btn(), border: `1px solid ${colors.danger}`, background: colors.card, color: colors.danger, fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.border}`, verticalAlign: 'top' });
export const input = (): CSSProperties => ({ padding: '0.4rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' });
export const label = (): CSSProperties => ({ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' });
export const select = (): CSSProperties => ({ ...input(), background: colors.card, cursor: 'pointer' });

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  // success / terminal-good
  active: { fg: colors.success, bg: tint(colors.success, 0.12) }, approved: { fg: colors.success, bg: tint(colors.success, 0.12) },
  published: { fg: colors.success, bg: tint(colors.success, 0.12) }, funded: { fg: colors.success, bg: tint(colors.success, 0.12) },
  paid: { fg: colors.success, bg: tint(colors.success, 0.12) }, completed: { fg: colors.success, bg: tint(colors.success, 0.12) },
  allocated: { fg: colors.success, bg: tint(colors.success, 0.12) }, live: { fg: colors.success, bg: tint(colors.success, 0.12) },
  reconciled: { fg: colors.success, bg: tint(colors.success, 0.12) }, disbursed: { fg: colors.success, bg: tint(colors.success, 0.12) },
  collected: { fg: colors.success, bg: tint(colors.success, 0.12) }, released: { fg: colors.success, bg: tint(colors.success, 0.12) },
  core: { fg: colors.success, bg: tint(colors.success, 0.12) },
  // pending / warn (amber)
  pending: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, in_review: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  under_review: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, needs_info: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  scheduled: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, low_balance: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  review: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, in_translation: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  funding: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, fee_due: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  onboarding: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, frequent: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  packaged: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, matured: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  // in-progress / info (blue)
  draft: { fg: colors.info, bg: tint(colors.info, 0.12) }, authoring: { fg: colors.info, bg: tint(colors.info, 0.12) },
  open: { fg: colors.info, bg: tint(colors.info, 0.12) }, upcoming: { fg: colors.info, bg: tint(colors.info, 0.12) },
  generated: { fg: colors.info, bg: tint(colors.info, 0.12) }, partial: { fg: colors.info, bg: tint(colors.info, 0.12) },
  // neutral / muted
  archived: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) }, legacy: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  closed: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) }, ended: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  inactive: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) }, depleted: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  // danger / terminal-bad
  rejected: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, failed: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  suspended: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, blocked: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  unfunded: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, expired: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  duplicate: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  // refund / reversal (purple)
  refunded: { fg: colors.primary, bg: tint(colors.primary, 0.12) }, reversed: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  redeemed: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  // difficulty
  easy: { fg: colors.success, bg: tint(colors.success, 0.12) }, medium: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  hard: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  // exam codes
  cce: { fg: colors.info, bg: tint(colors.info, 0.12) }, bece: { fg: colors.info, bg: tint(colors.info, 0.12) },
  wassce: { fg: colors.info, bg: tint(colors.info, 0.12) }, neco: { fg: colors.info, bg: tint(colors.info, 0.12) },
  utme: { fg: colors.info, bg: tint(colors.info, 0.12) }, nabteb: { fg: colors.info, bg: tint(colors.info, 0.12) },
  // ── Phase 3 — credentials / live / moderation ──
  issued: { fg: colors.success, bg: tint(colors.success, 0.12) }, routed: { fg: colors.success, bg: tint(colors.success, 0.12) },
  ready: { fg: colors.success, bg: tint(colors.success, 0.12) }, eligible: { fg: colors.success, bg: tint(colors.success, 0.12) },
  revoked: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, retired: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  paused: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, processing: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  triaged: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, submitted: { fg: colors.info, bg: tint(colors.info, 0.12) },
  none: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) }, cancelled: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  actioned: { fg: colors.success, bg: tint(colors.success, 0.12) }, dismissed: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  escalated: { fg: colors.danger, bg: tint(colors.danger, 0.12) }, hide: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  warn: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, ban: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  // severity
  low: { fg: colors.success, bg: tint(colors.success, 0.12) }, high: { fg: colors.warning, bg: tint(colors.warning, 0.12) },
  critical: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  // ── Phase 4 — schools / tutor ops / BI ──
  trial: { fg: colors.info, bg: tint(colors.info, 0.12) }, requested: { fg: colors.info, bg: tint(colors.info, 0.12) },
  investigating: { fg: colors.warning, bg: tint(colors.warning, 0.12) }, overdue: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  resolved: { fg: colors.success, bg: tint(colors.success, 0.12) }, void: { fg: colors.secondary, bg: tint(colors.secondary, 0.12) },
  applied: { fg: colors.info, bg: tint(colors.info, 0.12) }, verified: { fg: colors.success, bg: tint(colors.success, 0.12) },
  // activity kinds
  pool_funded: { fg: colors.success, bg: tint(colors.success, 0.12) }, reward_redeemed: { fg: colors.primary, bg: tint(colors.primary, 0.12) },
  item_approved: { fg: colors.success, bg: tint(colors.success, 0.12) }, item_rejected: { fg: colors.danger, bg: tint(colors.danger, 0.12) },
  cards_generated: { fg: colors.info, bg: tint(colors.info, 0.12) }, plan_published: { fg: colors.success, bg: tint(colors.success, 0.12) },
  badge_earned: { fg: colors.success, bg: tint(colors.success, 0.12) }, exam_opened: { fg: colors.info, bg: tint(colors.info, 0.12) },
  campaign_launched: { fg: colors.info, bg: tint(colors.info, 0.12) },
};

export function Badge({ status, label: lbl }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status.toLowerCase()] ?? { fg: colors.text, bg: colors.border };
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

type Tab = { href: string; label: string; key: string };

function Tabs({ active, tabs }: { active: string; tabs: Tab[] }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.text, background: active === t.key ? colors.primary : colors.border }}>{t.label}</Link>
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
    // Film Academy is a separate programme from the EdTech academy above; it is
    // grouped here because both are 'Academy' to an operator, not because they
    // share a backend.
    { href: '/admin/academy/film', label: 'Film Academy', key: 'film' },
  ]} />;
}

// Standard loading / empty / error placeholders for every list page.
export function StateBlock({ loading, error, empty, emptyText = 'No records found.', children }: PropsWithChildren<{ loading: boolean; error: string | null; empty: boolean; emptyText?: string }>) {
  if (loading) return <p style={{ color: colors.muted }}>Loading…</p>;
  if (error) return <p style={{ color: colors.danger }}>{error}</p>;
  if (empty) return <p style={{ color: colors.muted }}>{emptyText}</p>;
  return <>{children}</>;
}

// Disclosure banner — surfaces the Academy invariants admins must respect.
export function DisclosureNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: `1px solid ${tint(colors.primary, 0.24)}`, background: tint(colors.primary, 0.08), color: colors.primary, borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.78rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
}

// Inline note that a state-change action is recorded to the immutable audit log.
export function AuditNote({ children }: PropsWithChildren) {
  return (
    <div style={{ border: `1px solid ${tint(colors.warning, 0.35)}`, background: tint(colors.warning, 0.1), color: colors.warning, borderRadius: '0.375rem', padding: '0.4rem 0.6rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
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
export function Bar({ value, max, color = colors.primary, labelLeft, labelRight }: { value: number; max: number; color?: string; labelLeft?: string; labelRight?: string }) {
  const w = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      {labelLeft ? <span style={{ width: 110, flexShrink: 0, fontSize: '0.72rem', color: colors.muted }}>{labelLeft}</span> : null}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <div style={{ height: 10, width: `${w}%`, minWidth: 2, background: color, borderRadius: 2 }} />
        {labelRight ? <span style={{ fontSize: '0.7rem', color: colors.muted, whiteSpace: 'nowrap' }}>{labelRight}</span> : null}
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
