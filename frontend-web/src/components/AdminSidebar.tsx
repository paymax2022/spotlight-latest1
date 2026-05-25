'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AppLogo from '@/src/components/ui/AppLogo';

interface NavItem {
  label: string;
  href: string;
  section: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/admin', section: 'Core' },
  { label: 'Programs', href: '/admin/programs', section: 'Core' },
  { label: 'Contests', href: '/admin/contests', section: 'Core' },
  { label: 'Open Mic', href: '/admin/open-mic', section: 'Core' },
  { label: 'STEM', href: '/admin/stem', section: 'Core' },
  { label: 'Film Academy', href: '/admin/film-academy', section: 'Core' },
  { label: 'SME Pitch', href: '/admin/sme-pitch', section: 'Core' },

  { label: 'Applicants', href: '/admin/applicants', section: 'People' },
  { label: 'Contestants', href: '/admin/contestants', section: 'People' },
  { label: 'Voting', href: '/admin/voting', section: 'People' },
  { label: 'Stages & Evictions', href: '/admin/stages-evictions', section: 'People' },
  { label: 'Judges & Scores', href: '/admin/judges-scores', section: 'People' },
  { label: 'Badges & Referrals', href: '/admin/badges-referrals', section: 'People' },

  { label: 'Payments & Finance', href: '/admin/payments-finance', section: 'Operations' },
  { label: 'Sponsors & Partners', href: '/admin/sponsors-partners', section: 'Operations' },
  { label: 'Events', href: '/admin/events', section: 'Operations' },
  { label: 'Media & CMS', href: '/admin/media-cms', section: 'Operations' },
  { label: 'Notifications', href: '/admin/notifications', section: 'Operations' },
  { label: 'Reports & Analytics', href: '/admin/reports-analytics', section: 'Operations' },

  { label: 'Users & Roles', href: '/admin/users-roles', section: 'Governance' },
  { label: 'Audit Logs', href: '/admin/audit-logs', section: 'Governance' },
  { label: 'Settings', href: '/admin/settings', section: 'Governance' },
  { label: 'View Public Site', href: '/homepage', section: 'Governance' },
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

  const panelStyle: React.CSSProperties = {
    width: 280,
    background: 'var(--bg-card)',
    borderRight: '1px solid var(--border)',
    minHeight: '100vh',
    position: 'sticky',
    top: 0,
    overflowY: 'auto',
  };

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'var(--foreground-dim)',
    marginBottom: 8,
  };

  return (
    <>
      <div className="d-lg-none" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
        <div className="d-flex align-items-center justify-content-between px-3 py-2">
          <Link href="/admin" className="d-flex align-items-center text-decoration-none" style={{ gap: 10 }}>
            <AppLogo size={26} />
            <div>
              <div style={{ color: 'var(--foreground)', fontWeight: 700, lineHeight: 1.1 }}>Spotlight</div>
              <div style={{ color: 'var(--accent-gold)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>Admin</div>
            </div>
          </Link>
          <button
            type="button"
            className="btn btn-sm"
            style={{ color: 'var(--foreground)', border: '1px solid var(--border)' }}
            onClick={() => setMobileOpen((v) => !v)}
          >
            Menu
          </button>
        </div>
      </div>

      <aside className="d-none d-lg-block" style={panelStyle}>
        <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="d-flex align-items-center" style={{ gap: 10 }}>
            <AppLogo size={30} />
            <div>
              <div style={{ color: 'var(--foreground)', fontWeight: 700 }}>Spotlight</div>
              <div style={{ color: 'var(--accent-gold)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>Admin Portal</div>
            </div>
          </div>
        </div>

        <div className="px-3 py-3">
          {grouped.map(({ section, items }) => (
            <div key={section} style={{ marginBottom: 18 }}>
              <div style={sectionLabelStyle}>{section}</div>
              <div>
                {items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className="d-block text-decoration-none"
                      style={{
                        color: active ? 'var(--accent-gold)' : 'var(--foreground-muted)',
                        background: active ? 'var(--accent-gold-dim)' : 'transparent',
                        border: `1px solid ${active ? 'var(--border-gold)' : 'transparent'}`,
                        borderRadius: 4,
                        padding: '9px 12px',
                        marginBottom: 6,
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-3 py-3" style={{ borderTop: '1px solid var(--border)', color: 'var(--foreground-dim)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Spotlight OS · 2026
        </div>
      </aside>

      {mobileOpen && (
        <div className="d-lg-none" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 55 }} onClick={() => setMobileOpen(false)}>
          <div style={{ width: 300, maxWidth: '84vw', height: '100%', background: 'var(--bg-card)', borderRight: '1px solid var(--border)', paddingTop: 58, overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-3 py-2">
              {grouped.map(({ section, items }) => (
                <div key={section} style={{ marginBottom: 14 }}>
                  <div style={sectionLabelStyle}>{section}</div>
                  {items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className="d-block text-decoration-none"
                        style={{
                          color: active ? 'var(--accent-gold)' : 'var(--foreground-muted)',
                          background: active ? 'var(--accent-gold-dim)' : 'transparent',
                          border: `1px solid ${active ? 'var(--border-gold)' : 'transparent'}`,
                          borderRadius: 4,
                          padding: '9px 12px',
                          marginBottom: 6,
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        {item.label}
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
