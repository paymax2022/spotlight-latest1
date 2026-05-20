'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import AppLogo from '@/components/ui/AppLogo';
import Icon from '@/components/ui/AppIcon';

const Header: React.FC = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const navLinks = [
    { label: 'Home', href: '/homepage' },
    { label: 'Programs', href: '/about', hasDropdown: true },
    { label: 'Contest', href: '/contest', hasDropdown: true },
    { label: 'Leaderboard', href: '/contestant-leaderboard' },
    { label: 'Contact', href: '/contact' },
  ];

  return (
    <>
      <header
        className={`fixed top-0 left-0 w-full z-50 transition-all duration-500 ${
          scrolled ? 'bg-bg/90 backdrop-blur-xl border-b border-border' : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 md:px-8 py-5 flex items-center justify-between">
          {/* Logo */}
          <Link href="/homepage" className="flex items-center gap-2.5">
            <AppLogo size={36} />
            <span className="font-display text-xl font-bold tracking-tight text-foreground">
              Spotlight
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-10">
            {navLinks.map((link) =>
              link.hasDropdown ? (
                <div key={link.label} className="dropdown-trigger relative">
                  <Link
                    href={link.href}
                    className="nav-link text-sm font-medium text-foreground/70 hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    {link.label}
                    <Icon name="ChevronDownIcon" size={14} className="opacity-50" />
                  </Link>
                  {link.label === 'Programs' && (
                    <div className="dropdown-menu submenu-surface absolute top-full left-0 mt-4 w-52 rounded-md z-50">
                      <Link
                        href="/about?tab=reality-tv"
                        className="block px-5 py-3.5 text-sm text-foreground/70 hover:text-accent-gold hover:bg-accent-gold/5 transition-colors"
                      >
                        Reality TV Show
                      </Link>
                      <Link
                        href="/about?tab=film-academy"
                        className="block px-5 py-3.5 text-sm text-foreground/70 hover:text-accent-gold hover:bg-accent-gold/5 transition-colors"
                      >
                        Film Academy
                      </Link>
                      <Link
                        href="/music-bootcamp"
                        className="block px-5 py-3.5 text-sm text-foreground/70 hover:text-accent-gold hover:bg-accent-gold/5 transition-colors"
                      >
                        Music Bootcamp
                      </Link>
                    </div>
                  )}
                  {link.label === 'Contest' && (
                    <div className="dropdown-menu submenu-surface absolute top-full left-0 mt-4 w-56 rounded-md z-50">
                      <Link
                        href="/open-mic"
                        className="block px-5 py-3.5 text-sm text-foreground/70 hover:text-accent-gold hover:bg-accent-gold/5 transition-colors"
                      >
                        Open Mic
                      </Link>
                      <Link
                        href="/multi-skill-contest"
                        className="block px-5 py-3.5 text-sm text-foreground/70 hover:text-accent-gold hover:bg-accent-gold/5 transition-colors"
                      >
                        Multi Skill Contest
                      </Link>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  key={link.label}
                  href={link.href}
                  className="nav-link text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
                >
                  {link.label}
                </Link>
              )
            )}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-4">
            <Link
              href="/contestant-register"
              className="btn-outline text-xs py-2.5 px-5 flex items-center gap-1.5"
            >
              <Icon name="UserPlusIcon" size={13} />
              Register
            </Link>
            <Link href="/sign-up" className="btn-outline text-xs py-2.5 px-6">
              Sign Up
            </Link>
            <Link href="/user-dashboard" className="btn-primary text-xs py-2.5 px-6">
              Dashboard
            </Link>
          </div>

          {/* Mobile Hamburger */}
          <button
            className="md:hidden flex flex-col gap-1.5 p-2"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <span
              className={`block w-6 h-0.5 bg-foreground transition-all duration-300 ${mobileOpen ? 'rotate-45 translate-y-2' : ''}`}
            />
            <span
              className={`block w-6 h-0.5 bg-foreground transition-all duration-300 ${mobileOpen ? 'opacity-0' : ''}`}
            />
            <span
              className={`block w-6 h-0.5 bg-foreground transition-all duration-300 ${mobileOpen ? '-rotate-45 -translate-y-2' : ''}`}
            />
          </button>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-bg/95 backdrop-blur-xl mobile-menu ${mobileOpen ? 'open' : ''} md:hidden`}
        onClick={() => setMobileOpen(false)}
      >
        <div
          className="absolute right-0 top-0 h-full w-4/5 max-w-sm bg-bg-card border-l border-border flex flex-col pt-24 px-8"
          onClick={(e) => e.stopPropagation()}
        >
          <nav className="flex flex-col gap-2">
            {navLinks.map((link) => (
              <div key={link.label}>
                <Link
                  href={link.href}
                  className="block py-4 text-xl font-display font-light text-foreground/80 hover:text-accent-gold transition-colors border-b border-border"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
                {link.hasDropdown && link.label === 'Programs' && (
                  <div className="pl-4 flex flex-col gap-1 mt-1 mb-2">
                    <Link
                      href="/about?tab=reality-tv"
                      className="block py-2 text-sm text-foreground/50 hover:text-accent-gold transition-colors"
                      onClick={() => setMobileOpen(false)}
                    >
                      → Reality TV Show
                    </Link>
                    <Link
                      href="/about?tab=film-academy"
                      className="block py-2 text-sm text-foreground/50 hover:text-accent-gold transition-colors"
                      onClick={() => setMobileOpen(false)}
                    >
                      → Film Academy
                    </Link>
                    <Link
                      href="/music-bootcamp"
                      className="block py-2 text-sm text-foreground/50 hover:text-accent-gold transition-colors"
                      onClick={() => setMobileOpen(false)}
                    >
                      → Music Bootcamp
                    </Link>
                  </div>
                )}
                {link.hasDropdown && link.label === 'Contest' && (
                  <div className="pl-4 flex flex-col gap-1 mt-1 mb-2">
                    <Link
                      href="/open-mic"
                      className="block py-2 text-sm text-foreground/50 hover:text-accent-gold transition-colors"
                      onClick={() => setMobileOpen(false)}
                    >
                      → Open Mic
                    </Link>
                    <Link
                      href="/multi-skill-contest"
                      className="block py-2 text-sm text-foreground/50 hover:text-accent-gold transition-colors"
                      onClick={() => setMobileOpen(false)}
                    >
                      → Multi Skill Contest
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </nav>
          <div className="mt-10 flex flex-col gap-4">
            <Link
              href="/contestant-register"
              className="btn-outline text-center flex items-center justify-center gap-2"
              onClick={() => setMobileOpen(false)}
            >
              <Icon name="UserPlusIcon" size={14} />
              Register as Contestant
            </Link>
            <Link
              href="/sign-up"
              className="btn-outline text-center"
              onClick={() => setMobileOpen(false)}
            >
              Register Now
            </Link>
            <Link
              href="/user-dashboard"
              className="btn-primary text-center"
              onClick={() => setMobileOpen(false)}
            >
              Dashboard
            </Link>
          </div>
          <div className="mt-auto pb-10 flex gap-6">
            {['Instagram', 'Twitter', 'YouTube'].map((s) => (
              <a
                key={s}
                href="#"
                className="text-xs text-foreground/30 hover:text-accent-gold transition-colors font-medium"
              >
                {s}
              </a>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default Header;
