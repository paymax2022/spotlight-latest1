'use client';

// Associations ops console shares the savings/_ui light-card primitives and adds
// the module-local tab bar + RBAC helper.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';
import { colors, tint } from '@/components/ui/vuexy';
import {
  listAdminOrganisations, getSelectedOrgId, setSelectedOrgId, onSelectedOrgChange,
  type AdminOrgOption,
} from '@/services/associationAdminService';

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
    { href: '/admin/association/elections', label: 'Elections', key: 'elections' },
    { href: '/admin/association/import', label: 'Import', key: 'import' },
    { href: '/admin/association/audit', label: 'Audit log', key: 'audit' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: `1px solid ${colors.border}`, paddingBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} style={{ textDecoration: 'none', padding: '0.35rem 0.7rem', borderRadius: '0.375rem', fontSize: '0.85rem', fontWeight: 600, color: active === t.key ? '#fff' : colors.muted, background: active === t.key ? colors.primary : colors.bg }}>{t.label}</Link>
      ))}
    </div>
  );
}

// ── Org picker ────────────────────────────────────────────────────────────
// Every admin read/write in this console is scoped to ONE association
// organisation (backend resolveOrgID). Selection lives in
// associationAdminService's module-level singleton (localStorage-backed, so
// it survives navigation between these seven pages); this hook just makes
// that reactive for React, and <OrgPicker/> is the UI to change it.
export function useSelectedOrg(): string | null {
  const [orgId, setOrgId] = useState<string | null>(null);
  useEffect(() => {
    setOrgId(getSelectedOrgId());
    return onSelectedOrgChange(setOrgId);
  }, []);
  return orgId;
}

export function OrgPicker() {
  const orgId = useSelectedOrg();
  const [orgs, setOrgs] = useState<AdminOrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAdminOrganisations(search || undefined)
      .then((rows) => {
        if (cancelled) return;
        setOrgs(rows);
        // Land on a working dashboard by default rather than an empty
        // "select an org" state — the platform console has no org of its
        // own to default to, unlike a real per-org officer.
        if (!getSelectedOrgId() && rows.length > 0) setSelectedOrgId(rows[0].id);
      })
      .catch(() => setOrgs([]))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: colors.muted }}>Organisation</label>
      <select
        value={orgId ?? ''}
        onChange={(e) => setSelectedOrgId(e.target.value || null)}
        style={{ padding: '0.35rem 0.5rem', borderRadius: '0.375rem', border: `1px solid ${colors.border}`, fontSize: '0.85rem', minWidth: 280 }}
      >
        {orgs.length === 0 && <option value="">{loading ? 'Loading organisations…' : 'No organisations found'}</option>}
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {o.memberCount.toLocaleString('en-NG')} members{o.verified ? '' : ' · unverified'}
          </option>
        ))}
      </select>
      <input
        placeholder="Search organisations…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ padding: '0.35rem 0.5rem', borderRadius: '0.375rem', border: `1px solid ${colors.border}`, fontSize: '0.85rem', width: 220 }}
      />
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
    <div style={{ border: `1px solid ${tint(colors.danger, 0.35)}`, background: tint(colors.danger, 0.08), color: colors.danger, borderRadius: '0.5rem', padding: '0.6rem 0.8rem', fontSize: '0.8rem', marginBottom: '1rem' }}>
      {text}
    </div>
  );
}
