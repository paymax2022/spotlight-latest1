'use client';

// Associations ops console shares the savings/_ui light-card primitives and adds
// the module-local tab bar + RBAC helper.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';

export {
  card, btn, btnPrimary, btnDanger, th, td, input, label, select,
  Badge, PageHeader, Card, Kpi, StateBlock, DisclosureNote, AuditNote, FilterBar,
  timeAgo, fmtDate, pct,
} from '../savings/_ui';

type Tab = { href: string; label: string; key: string };

export function AssociationTabs({ active }: { active: string }) {
  const tabs: Tab[] = [
    { href: '/admin/association/dashboard', label: 'Overview', key: 'overview' },
    { href: '/admin/association/approvals', label: 'Approvals', key: 'approvals' },
    { href: '/admin/association/dues', label: 'Dues & finance', key: 'dues' },
    { href: '/admin/association/members', label: 'Members', key: 'members' },
    { href: '/admin/association/import', label: 'Import', key: 'import' },
    { href: '/admin/association/audit', label: 'Audit log', key: 'audit' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : '#374151', background: active === t.key ? '#340075' : '#f3f4f6' }}>{t.label}</Link>
      ))}
    </div>
  );
}

// ── RBAC ──────────────────────────────────────────────────────────────────
// Associations reuses the "savings" RBAC group per AdminSidebar.tsx (the
// association console was seeded against the same permission slugs — there is
// no dedicated `association.admin.*` slug family yet). Server RBAC on the Go
// handlers remains authoritative; these are UX-only gates to avoid dead ends.
export const ASSOCIATION_PERMS = {
  view: ['savings.admin.view', 'savings.admin.dashboard'],
  manage: ['savings.admin.recon', 'savings.admin.view'],
  auditRead: ['savings.admin.view', 'savings.admin.recon'],
} as const;

export function useAssociationPermissions() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch { /* unauthenticated handled by route guard */ }
  }, []);
  const can = (perms: readonly string[]) => hasAnyPermission(user, [...perms]);
  return { user, can };
}

export function PermissionBanner({ text = "You have read-only access — your role can view this page but can't submit actions." }: { text?: string }) {
  return (
    <div style={{ border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.8rem', marginBottom: '1rem' }}>
      {text}
    </div>
  );
}
