'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import { colors, tint } from '@/components/ui/vuexy';

// Shared presentational + RBAC helpers for the Pre-Consultation Intake console.
// Dark inline-style theme, matching the nutrition / merchant-onboarding pages.

// Permission keys for the intake admin module (kept here + in routeGuard).
export const INTAKE_PERMS = {
  manage: ['health.admin.intake'],
};

// Reads the cached admin user (same source as AdminSidebar / route guard) and
// exposes a permission check so pages can disable sensitive write affordances.
// Server still enforces — this only prevents dead-end UI. Mirrors
// useMobilityPermissions in app/admin/mobility/_ui.tsx.
export function useIntakePermissions() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch {
      /* unauthenticated handled by route guard */
    }
  }, []);
  const can = (perms: string[]) => hasAnyPermission(user, perms);
  return { user, can };
}

// ─── Style tokens ────────────────────────────────────────────────────────────

export const card: CSSProperties = { border: `1px solid ${colors.border}`, padding: 14, borderRadius: 8, background: colors.card };
export const th: CSSProperties = { padding: '8px 6px', fontWeight: 600, color: colors.muted };
export const td: CSSProperties = { padding: '8px 6px', color: colors.text };
export const input: CSSProperties = { background: colors.card, color: colors.text, border: `1px solid ${colors.inputBorder}`, padding: '5px 8px', borderRadius: 4 };
export const btn: CSSProperties = { background: colors.card, color: colors.text, border: `1px solid ${colors.inputBorder}`, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 };
export const btnPrimary: CSSProperties = { ...btn, background: colors.primary, color: '#fff', borderColor: colors.primary };

// ─── Common components ───────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ margin: 0 }}>{title}</h1>
        {subtitle ? <p style={{ fontSize: 13, opacity: 0.7, marginTop: 6, maxWidth: 720 }}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function BackLink() {
  return (
    <div style={{ marginBottom: 14 }}>
      <Link href="/admin/intake" style={{ fontSize: 13, opacity: 0.8 }}>← Intake console</Link>
    </div>
  );
}

export function Notice({ kind, children }: PropsWithChildren<{ kind: 'info' | 'audit' | 'support' }>) {
  const palette: Record<string, { bg: string; border: string; fg: string; icon: string }> = {
    info: { bg: tint(colors.info, 0.12), border: colors.info, fg: colors.info, icon: 'ℹ︎' },
    audit: { bg: tint(colors.warning, 0.12), border: colors.warning, fg: colors.warning, icon: '🔒' },
    support: { bg: tint(colors.success, 0.12), border: colors.success, fg: colors.success, icon: '🤝' },
  };
  const c = palette[kind];
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.fg, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>{c.icon}</span>
      <span>{children}</span>
    </div>
  );
}

const SEVERITY_COLORS: Record<string, { bg: string; fg: string }> = {
  emergency: { bg: tint(colors.danger, 0.12), fg: colors.danger },
  urgent: { bg: tint(colors.warning, 0.12), fg: colors.warning },
};

export function SeverityBadge({ severity }: { severity: string }) {
  const c = SEVERITY_COLORS[severity] ?? { bg: colors.bg, fg: colors.muted };
  return <span style={pill(c)}>{severity}</span>;
}

const ROUTING_COLORS: Record<string, { bg: string; fg: string }> = {
  EMERGENCY: { bg: tint(colors.danger, 0.12), fg: colors.danger },
  URGENT_CARE: { bg: tint(colors.warning, 0.12), fg: colors.warning },
  // CRISIS framed with a calm, supportive palette — not alarmist red.
  CRISIS: { bg: tint(colors.info, 0.12), fg: colors.info },
};

export function RoutingBadge({ routing }: { routing: string }) {
  const c = ROUTING_COLORS[routing] ?? { bg: colors.bg, fg: colors.muted };
  const label = routing === 'CRISIS' ? 'Crisis support' : routing.replace(/_/g, ' ').toLowerCase();
  return <span style={{ ...pill(c), textTransform: 'capitalize' }}>{label}</span>;
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  SUBMITTED: { bg: tint(colors.success, 0.12), fg: colors.success },
  DRAFT: { bg: tint(colors.warning, 0.12), fg: colors.warning },
  NOT_STARTED: { bg: colors.bg, fg: colors.muted },
};

export function IntakeStatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { bg: colors.bg, fg: colors.muted };
  return <span style={{ ...pill(c), textTransform: 'capitalize' }}>{status.replace(/_/g, ' ').toLowerCase()}</span>;
}

const DISPOSITION_COLORS: Record<string, { bg: string; fg: string }> = {
  OPEN: { bg: tint(colors.warning, 0.12), fg: colors.warning },
  ROUTED: { bg: tint(colors.primary, 0.12), fg: colors.primary },
  CONTACTED: { bg: tint(colors.info, 0.12), fg: colors.info },
  RESOLVED: { bg: tint(colors.success, 0.12), fg: colors.success },
};

export function DispositionBadge({ disposition }: { disposition: string }) {
  const c = DISPOSITION_COLORS[disposition] ?? { bg: colors.bg, fg: colors.muted };
  return <span style={{ ...pill(c), textTransform: 'capitalize' }}>{disposition.toLowerCase()}</span>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  const c = active ? { bg: tint(colors.success, 0.12), fg: colors.success } : { bg: colors.bg, fg: colors.muted };
  return <span style={pill(c)}>{active ? 'active' : 'inactive'}</span>;
}

function pill(c: { bg: string; fg: string }): CSSProperties {
  return { background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' };
}
