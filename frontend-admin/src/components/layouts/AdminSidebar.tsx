'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AdminMenuCounts } from '@/types/admin';
import { getAdminMenuCounts } from '@/services/adminApiClient';
import { canManageStem, canReadStem, getCurrentStemRole } from '@/config/stemAccess';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';

type NavItem = {
  label: string;
  href: string;
  section: string;
  countKey?: keyof AdminMenuCounts;
  stemAccess?: 'read' | 'manage';
  permissions?: string[];
};

const navItemsBase: NavItem[] = [
  { label: 'Dashboard', href: '/admin', section: 'Overview' },
  { label: 'Analytics', href: '/admin/analytics', section: 'Overview' },
  { label: 'Competitions', href: '/admin/competitions', section: 'Contests', countKey: 'open_mic', permissions: ['contest.create', 'contest.update', 'contest.publish'] },
  { label: 'Open Mic Editions', href: '/admin/competitions/open-mic', section: 'Contests' },
  { label: 'Chat Sessions', href: '/admin/chatbot', section: 'Support' },
  { label: 'Leads Queue', href: '/admin/leads', section: 'Support' },
  { label: 'Handoff Queue', href: '/admin/handoffs', section: 'Support' },
  { label: 'Users', href: '/admin/users', section: 'Support', permissions: ['users.view'] },
  { label: 'Roles', href: '/admin/roles', section: 'Support', permissions: ['roles.view'] },
  { label: 'RBAC Settings', href: '/admin/rbac-settings', section: 'Support', permissions: ['roles.view'] },
  { label: 'Permission Matrix', href: '/admin/permissions-matrix', section: 'Support', permissions: ['permissions.view'] },
  { label: 'Permissions', href: '/admin/permissions', section: 'Support', permissions: ['permissions.view'] },
  { label: 'Audit Logs', href: '/admin/audit-logs', section: 'Support', permissions: ['audit.logs.view'] },
  { label: 'Login Activity', href: '/admin/login-activity', section: 'Support', permissions: ['audit.logs.view'] },
  { label: 'Security Events', href: '/admin/security-events', section: 'Support', permissions: ['audit.logs.view'] },
  { label: 'Reality TV', href: '/admin/reality-tv/dashboard', section: 'Programs' },
  { label: 'Film Academy', href: '/admin/film-academy', section: 'Programs' },
  { label: 'Bootcamp', href: '/admin/bootcamp', section: 'Programs' },
  { label: 'STEM Overview', href: '/admin/stem/overview', section: 'Programs', stemAccess: 'read', permissions: ['contestant.view'] },
  { label: 'STEM Contests', href: '/admin/stem/contests', section: 'Programs', stemAccess: 'manage', permissions: ['contest.create', 'contest.update'] },
  { label: 'STEM Leaderboard', href: '/admin/stem/leaderboard', section: 'Programs', stemAccess: 'read' },
  { label: 'STEM Voting', href: '/admin/stem/voting', section: 'Programs', stemAccess: 'manage' },
  { label: 'STEM Bootcamp', href: '/admin/stem/bootcamp', section: 'Programs', stemAccess: 'manage' },
  { label: 'STEM Reports', href: '/admin/stem/reports', section: 'Programs', stemAccess: 'read' },
  { label: 'STEM Sponsors/Awards', href: '/admin/stem/sponsors-awards', section: 'Programs', stemAccess: 'manage' },
  { label: 'STEM Submissions', href: '/admin/stem/submissions', section: 'Programs', stemAccess: 'read' },
  { label: 'STEM Judging', href: '/admin/stem/judging', section: 'Programs', stemAccess: 'read' },
  { label: 'STEM Rubrics', href: '/admin/stem/rubrics', section: 'Programs', stemAccess: 'manage' },
  { label: 'Schools', href: '/admin/schools', section: 'Programs', stemAccess: 'read' },
  { label: 'School Profiles', href: '/admin/school-profiles', section: 'Programs', stemAccess: 'read' },
  { label: 'School Teams', href: '/admin/school-teams', section: 'Programs', stemAccess: 'read' },
  { label: 'Emerging Innovators', href: '/admin/emerging-innovators', section: 'Programs', stemAccess: 'read' },
  { label: 'Emerging Teams', href: '/admin/emerging-teams', section: 'Programs', stemAccess: 'read' },
  { label: 'Emerging Projects', href: '/admin/emerging-projects', section: 'Programs', stemAccess: 'read' },
  { label: 'STEM Applications', href: '/admin/stem/applications', section: 'Programs', countKey: 'stem' },
  { label: 'Template Manager', href: '/admin/template-manager', section: 'Programs' },
  { label: 'Users & Services', href: '/admin/users-services', section: 'Programs' },
];

const sections = ['Overview', 'Contests', 'Support', 'Programs'];

export function AdminSidebar() {
  const pathname = usePathname() ?? '';
  const [counts, setCounts] = useState<AdminMenuCounts | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const role = getCurrentStemRole();
  const allowRead = canReadStem(role);
  const allowManage = canManageStem(role);

  useEffect(() => {
    void getAdminMenuCounts().then(setCounts);
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setAuthUser(JSON.parse(raw) as AuthUser);
    } catch {}
  }, []);

  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <aside style={{ width: 280, borderRight: '1px solid #2a2a2a', minHeight: '100vh', padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Spotlight Admin</h2>
      {sections.map((section) => {
        const items = navItemsBase.filter((item) => {
          if (item.section !== section) return false;
          if (item.stemAccess === 'read' && !allowRead) return false;
          if (item.stemAccess === 'manage' && !allowManage) return false;
          if (item.permissions?.length && !hasAnyPermission(authUser, item.permissions)) return false;
          return true;
        });
        if (!items.length) return null;
        return (
          <div key={section} style={{ marginTop: 16 }}>
            <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>{section}</p>
            <div style={{ display: 'grid', gap: 6 }}>
              {items.map((item) => {
                const count = item.countKey && counts ? counts[item.countKey] : null;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      border: '1px solid #2a2a2a',
                      background: isActive(item.href) ? '#1f1f1f' : 'transparent',
                    }}
                  >
                    <span>{item.label}</span>
                    {typeof count === 'number' && count > 0 ? <strong>{count}</strong> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
