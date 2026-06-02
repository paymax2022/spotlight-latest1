'use client';

import Link from 'next/link';
import { useState } from 'react';

const topNav = [
  { label: 'Home', href: '/homepage' },
  { label: 'About', href: '/about' },
  { label: 'Season 2', href: '/season-2' },
  { label: 'Apply', href: '/apply' },
  { label: 'Voting', href: '/voting' },
  { label: 'Talent Vault', href: '/talent-vault' },
  { label: 'Sponsors', href: '/sponsor' },
  { label: 'Studios', href: '/studios' },
  { label: 'Media Room', href: '/media-room' },
  { label: 'Contact', href: '/contact' },
];

const groupedLinks = {
  Programmes: [
    { label: 'Season 2', href: '/season-2' },
    { label: 'Apply/Register', href: '/apply' },
    { label: 'Voting', href: '/voting' },
    { label: 'Talent Vault', href: '/talent-vault' },
  ],
  Partnerships: [
    { label: 'Sponsors', href: '/sponsor' },
    { label: 'Government Partnerships', href: '/government-partnerships' },
    { label: 'Brand Activation', href: '/brand-activation' },
  ],
  Media: [
    { label: 'Spotlight Studios', href: '/studios' },
    { label: 'Media Room', href: '/media-room' },
  ],
};

export default function SpotlightHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-bg/90 backdrop-blur-xl border-b border-border">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
        <div className="flex items-center justify-between gap-4">
          <Link href="/homepage" className="font-display text-xl md:text-2xl text-foreground font-bold tracking-tight">Spotlight</Link>
          <button type="button" className="md:hidden btn-outline px-4 py-2 text-xs" onClick={() => setOpen((v) => !v)}>Menu</button>
          <nav className="hidden md:flex items-center gap-5 text-sm">{topNav.map((item) => <Link key={item.label} href={item.href} className="nav-link text-foreground/80 hover:text-foreground">{item.label}</Link>)}</nav>
          <div className="hidden md:flex items-center gap-3">
            <Link href="/sponsor" className="btn-outline text-xs py-2.5 px-4">Sponsor Partnership</Link>
            <Link href="/apply" className="btn-primary text-xs py-2.5 px-4">Apply Now</Link>
          </div>
        </div>
        {open && (
          <div className="md:hidden mt-4 border-t border-border pt-4 space-y-4">
            {topNav.map((item) => <Link key={item.label} href={item.href} className="block text-sm text-foreground/80" onClick={() => setOpen(false)}>{item.label}</Link>)}
            {Object.entries(groupedLinks).map(([group, links]) => (
              <div key={group} className="pt-2 border-t border-border">
                <p className="text-xs text-foreground/50 mb-2 uppercase">{group}</p>
                <div className="space-y-2">{links.map((link) => <Link key={link.label} href={link.href} className="block text-xs text-foreground/70" onClick={() => setOpen(false)}>{link.label}</Link>)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
