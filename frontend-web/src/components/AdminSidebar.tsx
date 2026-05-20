'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import Icon from '@/components/ui/AppIcon';

interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: string;
  section?: string;
}

const navItems: NavItem[] = [
  // Overview
  { label: 'Dashboard', href: '/admin', icon: 'HomeIcon', section: 'Overview' },
  { label: 'Analytics', href: '/admin-analytics', icon: 'ChartBarIcon', section: 'Overview' },

  // Contestants
  {
    label: 'Applicants',
    href: '/admin-panel',
    icon: 'ClipboardDocumentListIcon',
    section: 'Contestants',
  },
  {
    label: 'Contestant Mgmt',
    href: '/contestant-management',
    icon: 'UsersIcon',
    section: 'Contestants',
  },
  {
    label: 'Leaderboard',
    href: '/contestant-leaderboard',
    icon: 'TrophyIcon',
    section: 'Contestants',
  },

  // Contests
  {
    label: 'Multi Skill Contest',
    href: '/contest-management',
    icon: 'StarIcon',
    section: 'Contests',
  },
  {
    label: 'Open Mic',
    href: '/admin/competitions/open-mic',
    icon: 'MusicalNoteIcon',
    section: 'Contests',
  },
  {
    label: 'Skill Categories',
    href: '/admin/categories',
    icon: 'SquaresPlusIcon',
    section: 'Contests',
  },
  {
    label: 'Winner Management',
    href: '/admin/winner-management',
    icon: 'TrophyIcon',
    section: 'Contests',
  },
  {
    label: 'Template Manager',
    href: '/admin/template-manager',
    icon: 'PhotoIcon',
    section: 'Contests',
  },

  // Programs
  { label: 'Auditions', href: '/admin/auditions', icon: 'MicrophoneIcon', section: 'Programs' },
  { label: 'Film Academy', href: '/admin/academy', icon: 'AcademicCapIcon', section: 'Programs' },
  {
    label: 'Academy LMS',
    href: '/admin/academy/lms',
    icon: 'BookOpenIcon',
    section: 'Programs',
  },
  {
    label: 'Music Bootcamp',
    href: '/admin/bootcamp',
    icon: 'MusicalNoteIcon',
    section: 'Programs',
  },

  // Security
  {
    label: 'Fraud Detection',
    href: '/fraud-detection',
    icon: 'ShieldExclamationIcon',
    section: 'Security',
  },

  // Public Site
  {
    label: 'View Public Site',
    href: '/homepage',
    icon: 'ArrowTopRightOnSquareIcon',
    section: 'Public Site',
  },
];

const sections = ['Overview', 'Contestants', 'Contests', 'Programs', 'Security', 'Public Site'];

const AdminSidebar: React.FC = () => {
  const pathname = usePathname() ?? '';
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-border flex items-center gap-3">
        <AppLogo size={32} />
        <div>
          <span className="font-display text-base font-bold text-foreground block leading-tight">
            Spotlight
          </span>
          <span className="text-[9px] text-accent-gold uppercase tracking-widest font-bold">
            Admin Portal
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {sections.map((section) => {
          const items = navItems.filter((n) => n.section === section);
          if (!items.length) return null;
          return (
            <div key={section}>
              <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-foreground/25 px-3 mb-2">
                {section}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-all duration-150 group ${
                      isActive(item.href)
                        ? 'bg-accent-gold/10 text-accent-gold border border-accent-gold/20'
                        : 'text-foreground/50 hover:text-foreground hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      size={16}
                      className={
                        isActive(item.href)
                          ? 'text-accent-gold'
                          : 'text-foreground/40 group-hover:text-foreground/70'
                      }
                      variant="outline"
                    />
                    <span>{item.label}</span>
                    {item.badge && (
                      <span className="ml-auto text-[10px] bg-accent-red/20 text-accent-red px-1.5 py-0.5 rounded-full font-bold">
                        {item.badge}
                      </span>
                    )}
                    {item.href === '/homepage' && (
                      <Icon
                        name="ArrowTopRightOnSquareIcon"
                        size={11}
                        className="ml-auto text-foreground/20"
                      />
                    )}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border">
        <p className="text-[10px] text-foreground/20 tracking-widest uppercase">Season 4 · 2026</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 bg-bg-card border-r border-border h-screen sticky top-0 overflow-hidden">
        <SidebarContent />
      </aside>

      {/* Mobile Top Bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <Link href="/admin" className="flex items-center gap-2.5">
          <AppLogo size={28} />
          <div>
            <span className="font-display text-sm font-bold text-foreground block leading-tight">
              Spotlight
            </span>
            <span className="text-[8px] text-accent-gold uppercase tracking-widest font-bold">
              Admin
            </span>
          </div>
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 text-foreground/60 hover:text-foreground transition-colors"
          aria-label="Toggle admin menu"
        >
          <Icon name={mobileOpen ? 'XMarkIcon' : 'Bars3Icon'} size={20} />
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-bg/80 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="absolute left-0 top-0 h-full w-72 bg-bg-card border-r border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pt-16 h-full overflow-y-auto">
              <SidebarContent />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AdminSidebar;
