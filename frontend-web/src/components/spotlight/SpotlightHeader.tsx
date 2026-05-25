'use client';

import Link from 'next/link';
import { useState } from 'react';
import { serviceMenu } from '@/src/data/services';

const topNav = [
  { label: 'Home', href: '/homepage' },
  { label: 'About Spotlight', href: '/about' },
  { label: 'Services', href: '/services', mega: true },
  { label: 'Programs', href: '/programs' },
  { label: 'Sponsors & Partners', href: '/sponsors-partners' },
  { label: 'Media', href: '/media' },
  { label: 'Impact', href: '/impact' },
  { label: 'STEM Contests', href: '/stem/contests' },
  { label: 'Apply / Register', href: '/apply/reality-tv-show' },
  { label: 'Contact', href: '/contact' },
];

export default function SpotlightHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-bg/90 backdrop-blur-xl border-b border-border">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
        <div className="flex items-center justify-between gap-4">
          <Link href="/homepage" className="font-display text-xl md:text-2xl text-foreground font-bold tracking-tight">
            Spotlight
          </Link>

          <button
            type="button"
            className="md:hidden btn-outline px-4 py-2 text-xs"
            onClick={() => setOpen((v) => !v)}
          >
            Menu
          </button>

          <nav className="hidden md:flex items-center gap-5 text-sm">
            {topNav.map((item) =>
              item.mega ? (
                <div key={item.label} className="dropdown-trigger relative">
                  <Link href={item.href} className="nav-link text-foreground/80 hover:text-foreground">
                    {item.label}
                  </Link>
                  <div className="dropdown-menu submenu-surface absolute top-full left-1/2 -translate-x-1/2 mt-4 w-[900px] rounded-md z-50 p-5">
                    <div className="grid grid-cols-2 gap-4">
                      {serviceMenu.map((service) => (
                        <Link
                          key={service.href}
                          href={service.href}
                          className="block p-3 rounded-md hover:bg-accent-gold/10 transition-colors"
                        >
                          <p className="text-sm font-semibold text-foreground">{service.title}</p>
                          <p className="text-xs text-foreground/60 mt-1 leading-relaxed">{service.description}</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <Link key={item.label} href={item.href} className="nav-link text-foreground/80 hover:text-foreground">
                  {item.label}
                </Link>
              )
            )}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/services/corporate-sponsorship-activation" className="btn-outline text-xs py-2.5 px-4">
              Sponsor a Program
            </Link>
            <Link href="/apply/reality-tv-show" className="btn-primary text-xs py-2.5 px-4">
              Apply Now
            </Link>
          </div>
        </div>

        {open && (
          <div className="md:hidden mt-4 border-t border-border pt-4 space-y-3">
            {topNav.map((item) => (
              <div key={item.label}>
                <Link href={item.href} className="block text-sm text-foreground/80" onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
                {item.mega && (
                  <div className="mt-2 pl-3 border-l border-border space-y-2">
                    {serviceMenu.map((service) => (
                      <Link key={service.href} href={service.href} className="block text-xs text-foreground/60" onClick={() => setOpen(false)}>
                        {service.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
