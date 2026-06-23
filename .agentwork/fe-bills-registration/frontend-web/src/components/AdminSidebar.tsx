'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AppLogo from '@/src/components/ui/AppLogo';

interface NavItem {
  label: string;
  href: string;
  section: string;
  icon: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/admin', section: 'Core', icon: 'fa-chart-pie' },
  { label: 'Programs', href: '/admin/programs', section: 'Core', icon: 'fa-layer-group' },
  { label: 'Contests', href: '/admin/contests', section: 'Core', icon: 'fa-trophy' },
  { label: 'Open Mic', href: '/admin/open-mic', section: 'Core', icon: 'fa-microphone-lines' },
  { label: 'STEM', href: '/admin/stem', section: 'Core', icon: 'fa-atom' },
  { label: 'Film Academy', href: '/admin/film-academy', section: 'Core', icon: 'fa-graduation-cap' },
  { label: 'Academy Settings', href: '/admin/film-academy/settings', section: 'Core', icon: 'fa-sliders' },
  { label: 'SME Pitch', href: '/admin/sme-pitch', section: 'Core', icon: 'fa-briefcase' },

  { label: 'Applicants', href: '/admin/applicants', section: 'People', icon: 'fa-users' },
  { label: 'Contestants', href: '/admin/contestants', section: 'People', icon: 'fa-user-check' },
  { label: 'Voting', href: '/admin/voting', section: 'People', icon: 'fa-square-poll-vertical' },
  { label: 'Stages & Evictions', href: '/admin/stages-evictions', section: 'People', icon: 'fa-list-check' },
  { label: 'Judges & Scores', href: '/admin/judges-scores', section: 'People', icon: 'fa-star-half-stroke' },
  { label: 'Badges & Referrals', href: '/admin/badges-referrals', section: 'People', icon: 'fa-award' },

  { label: 'Payments & Finance', href: '/admin/payments-finance', section: 'Operations', icon: 'fa-wallet' },
  { label: 'Utility Payments', href: '/admin/utility', section: 'Operations', icon: 'fa-bolt' },
  { label: 'Sponsors & Partners', href: '/admin/sponsors-partners', section: 'Operations', icon: 'fa-handshake' },
  { label: 'Events', href: '/admin/events', section: 'Operations', icon: 'fa-calendar-days' },
  { label: 'Media & CMS', href: '/admin/media-cms', section: 'Operations', icon: 'fa-newspaper' },
  { label: 'Notifications', href: '/admin/notifications', section: 'Operations', icon: 'fa-envelope' },
  { label: 'Reports & Analytics', href: '/admin/reports-analytics', section: 'Operations', icon: 'fa-chart-line' },

  { label: 'Users & Roles', href: '/admin/users-roles', section: 'Governance', icon: 'fa-user-shield' },
  { label: 'Audit Logs', href: '/admin/audit-logs', section: 'Governance', icon: 'fa-clipboard-list' },
  { label: 'Settings', href: '/admin/settings', section: 'Governance', icon: 'fa-gear' },
  { label: 'View Public Site', href: '/homepage', section: 'Governance', icon: 'fa-arrow-up-right-from-square' },
];

const sections = ['Core', 'People', 'Operations', 'Governance'];

export default function AdminSidebar() {
  const pathname = usePathname() ?? '';
  const [mobileOpen, setMobileOpen] = useState(false);

  const grouped = useMemo(
    () => sections.map((section) => ({ section, items: navItems.filter((n) => n.section === section) })),
    []
  );

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      <div className="admin-mobile-bar">
        <div className="admin-mobile-inner">
          <Link href="/admin" className="admin-brand">
            <span className="admin-brand-mark"><AppLogo size={26} /></span>
            <span className="admin-brand-text">Spotlight</span>
          </Link>
          <button type="button" className="admin-icon-button" onClick={() => setMobileOpen((v) => !v)} aria-label="Open admin menu">
            <i className="fa-solid fa-bars" aria-hidden="true" />
          </button>
        </div>
      </div>

      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <Link href="/admin" className="admin-brand">
            <span className="admin-brand-mark"><AppLogo size={32} /></span>
            <span className="admin-brand-text">Spotlight</span>
          </Link>
          <span className="admin-sidebar-dot" />
        </div>

        <div className="admin-nav">
          {grouped.map(({ section, items }) => (
            <div key={section} className="admin-nav-section">
              <div className="admin-nav-section-title">{section}</div>
              <div>
                {items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`admin-nav-link${active ? ' active' : ''}`}
                    >
                      <i className={`fa-solid ${item.icon}`} aria-hidden="true" />
                      <span>{item.label}</span>
                      {item.href === '/admin' ? <strong>5</strong> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {mobileOpen && (
        <div className="admin-mobile-overlay" onClick={() => setMobileOpen(false)}>
          <div className="admin-mobile-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="admin-sidebar-header">
              <Link href="/admin" className="admin-brand">
                <span className="admin-brand-mark"><AppLogo size={30} /></span>
                <span className="admin-brand-text">Spotlight</span>
              </Link>
            </div>
            <div className="admin-nav">
              {grouped.map(({ section, items }) => (
                <div key={section} className="admin-nav-section">
                  <div className="admin-nav-section-title">{section}</div>
                  {items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`admin-nav-link${active ? ' active' : ''}`}
                      >
                        <i className={`fa-solid ${item.icon}`} aria-hidden="true" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
