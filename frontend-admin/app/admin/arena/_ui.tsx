'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import type { CompetitionStatus, ContestantState, DisbursementStatus, CredentialStatus } from '@/types/arenaAdmin';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational + RBAC helpers for the Arena admin console.
// Restyled to the shared Vuexy light-card convention (see @/components/ui/vuexy).

export const card = (): CSSProperties => ({ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '1rem', background: colors.card });
export const btn = (): CSSProperties => ({ padding: '0.35rem 0.8rem', borderRadius: '0.375rem', border: `1px solid ${colors.inputBorder}`, background: colors.card, cursor: 'pointer', fontSize: '0.85rem' });
export const btnPrimary = (bg = colors.primary): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
export const btnDisabled = (): CSSProperties => ({ padding: '0.4rem 0.9rem', borderRadius: '0.375rem', border: `1px solid ${colors.border}`, background: colors.headBg, color: colors.muted, cursor: 'not-allowed', fontSize: '0.85rem', fontWeight: 600 });
export const th = (): CSSProperties => ({ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'left', color: colors.muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.3 });
export const td = (): CSSProperties => ({ padding: '0.55rem 0.5rem', color: colors.text, fontSize: '0.85rem', borderTop: `1px solid ${colors.border}` });
export const selectStyle = (): CSSProperties => ({ padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem' });
export const inputStyle = (): CSSProperties => ({ padding: '0.35rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem', boxSizing: 'border-box' });
export const mono = (): CSSProperties => ({ fontFamily: 'monospace', fontSize: '0.8rem' });

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{title}</h1>
        {subtitle ? <p style={{ color: colors.muted, margin: '0.25rem 0 0', fontSize: '0.85rem' }}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, children, right }: PropsWithChildren<{ title?: string; right?: ReactNode }>) {
  return (
    <div style={{ ...card(), marginBottom: '1.25rem' }}>
      {title ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

// Amber banner used to flag scaffolded (not-yet-wired-to-full-workflow) screens.
export function ScaffoldNotice({ children }: PropsWithChildren) {
  return (
    <div style={{ background: tint(colors.warning, 0.1), border: `1px solid ${tint(colors.warning, 0.4)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.warning, marginBottom: '1.25rem' }}>
      <strong>Scaffold.</strong> {children}
    </div>
  );
}

// Every write in this console is audited server-side. Surfaced consistently so
// operators know their action is logged (actor, entity, before/after, ts).
export function AuditNote({ children }: PropsWithChildren) {
  return (
    <p style={{ color: colors.muted, fontSize: '0.75rem', margin: '0.5rem 0 0' }}>
      🛈 {children ?? 'Every action here writes an immutable audit_log row (actor, entity, before/after, timestamp). Backend RBAC is authoritative.'}
    </p>
  );
}

// Red banner: caller lacks the console's permission — reads allowed, writes gated.
export function PermissionBanner({ permission }: { permission: string }) {
  return (
    <div style={{ background: tint(colors.danger, 0.1), border: `1px solid ${tint(colors.danger, 0.4)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.danger, marginBottom: '1.25rem' }}>
      You lack <code>{permission}</code>. You can view this console but actions are disabled. Backend RBAC is authoritative.
    </div>
  );
}

export function timeAgo(isoStr?: string | null): string {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const past = diff >= 0;
  const m = Math.floor(Math.abs(diff) / 60_000);
  if (m < 1) return 'just now';
  const fmt = (n: number, u: string) => (past ? `${n}${u} ago` : `in ${n}${u}`);
  if (m < 60) return fmt(m, 'm');
  const h = Math.floor(m / 60);
  if (h < 24) return fmt(h, 'h');
  return fmt(Math.floor(h / 24), 'd');
}

export function BackToArena() {
  return (
    <Link href="/admin/arena/config" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>
      ← Back to Arena consoles
    </Link>
  );
}

// ── Badges ──────────────────────────────────────────────────────────────────

const COMPETITION_STATUS_COLORS: Record<CompetitionStatus, { fg: string; bg: string }> = {
  DRAFT:      { fg: colors.muted, bg: colors.headBg },
  CONFIGURED: { fg: '#1d4ed8', bg: '#dbeafe' },
  PUBLISHED:  { fg: '#15803d', bg: '#dcfce7' },
  LIVE:       { fg: '#15803d', bg: '#dcfce7' },
  FINALE:     { fg: '#9a3412', bg: '#ffedd5' },
  COMPLETED:  { fg: '#6b21a8', bg: '#f3e8ff' },
  ARCHIVED:   { fg: '#6b7280', bg: '#f3f4f6' },
};

export function CompetitionStatusBadge({ status }: { status: CompetitionStatus }) {
  const c = COMPETITION_STATUS_COLORS[status] ?? { fg: colors.muted, bg: colors.headBg };
  return <Pill fg={c.fg} bg={c.bg}>{status}</Pill>;
}

const STATE_COLORS: Record<ContestantState, { fg: string; bg: string }> = {
  APPLIED:         { fg: colors.muted, bg: colors.headBg },
  SCREENED:        { fg: '#1d4ed8', bg: '#dbeafe' },
  REJECTED:        { fg: '#b91c1c', bg: '#fee2e2' },
  TRAINED:         { fg: '#1d4ed8', bg: '#dbeafe' },
  THEORY_ASSIGNED: { fg: '#9a3412', bg: '#ffedd5' },
  THEORY_TAKEN:    { fg: '#9a3412', bg: '#ffedd5' },
  QUALIFIED:       { fg: '#15803d', bg: '#dcfce7' },
  FINALIST:        { fg: '#15803d', bg: '#dcfce7' },
  CROWNED:         { fg: '#92400e', bg: '#fef3c7' },
  ELIMINATED:      { fg: '#b91c1c', bg: '#fee2e2' },
  WITHDRAWN:       { fg: '#6b7280', bg: '#f3f4f6' },
};

export function StateBadge({ state }: { state: ContestantState }) {
  const c = STATE_COLORS[state] ?? { fg: colors.muted, bg: colors.headBg };
  return <Pill fg={c.fg} bg={c.bg}>{state.replace(/_/g, ' ')}</Pill>;
}

const DISBURSE_COLORS: Record<DisbursementStatus, { fg: string; bg: string }> = {
  NONE:             { fg: '#6b7280', bg: '#f3f4f6' },
  PENDING_APPROVAL: { fg: '#9a3412', bg: '#ffedd5' },
  APPROVED:         { fg: '#1d4ed8', bg: '#dbeafe' },
  EXECUTING:        { fg: '#1d4ed8', bg: '#dbeafe' },
  DISBURSED:        { fg: '#15803d', bg: '#dcfce7' },
  FAILED:           { fg: '#b91c1c', bg: '#fee2e2' },
};

export function DisbursementBadge({ status }: { status: DisbursementStatus }) {
  const c = DISBURSE_COLORS[status] ?? { fg: colors.muted, bg: colors.headBg };
  return <Pill fg={c.fg} bg={c.bg}>{status.replace(/_/g, ' ')}</Pill>;
}

export function CredentialBadge({ status }: { status: CredentialStatus }) {
  const c = status === 'ISSUED' ? { fg: '#15803d', bg: '#dcfce7' } : { fg: '#b91c1c', bg: '#fee2e2' };
  return <Pill fg={c.fg} bg={c.bg}>{status}</Pill>;
}

export function Pill({ children, fg, bg }: PropsWithChildren<{ fg: string; bg: string }>) {
  return (
    <span style={{ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: fg, background: bg }}>
      {children}
    </span>
  );
}

// Small "LOCKED" chip for NDC-1 crown←Merit binding.
export function LockedChip({ label = 'LOCKED' }: { label?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 700, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a' }}>
      🔒 {label}
    </span>
  );
}

// ── RBAC ──────────────────────────────────────────────────────────────────
// Per-console permissions. Server RBAC (arena.*) remains authoritative — these
// are UX gates only. Mirrors kyc-verify useKycPermissions.
export const ARENA_PERMS = {
  admin: 'arena.admin.manage', // A1/A5/A7/A9 (Competition Admin)
  potDisburse: 'arena.admin.disburse',
  questions: 'arena.admin.questions', // Quiz Bank (Naija Driver quiz management)
  reviewer: 'arena.reviewer.screen', // A2
  proctor: 'arena.proctor.attest', // A3
  judge: 'arena.judge.score', // A4
  auditor: 'arena.auditor.read', // A6
} as const;

export function useArenaUser(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch { /* unauthenticated handled by route guard */ }
  }, []);
  return user;
}

// Returns whether the caller holds ANY of the given permissions (UX gate).
export function useArenaPermission(...permissions: string[]) {
  const user = useArenaUser();
  const allowed = hasAnyPermission(user, permissions);
  return { user, allowed, permission: permissions[0] };
}
