'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowIcon } from './Icons';
import { LOGO, siteNav } from './content';
import { useJoinDialog } from './JoinDialog';


/**
 * The mock's own sticky chrome, kept instead of the shared template header so
 * this page can carry the type and colour system it was designed around.
 */
export default function LandingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { open } = useJoinDialog();
  const menuRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !toggleRef.current?.contains(target)) closeMenu();
    };
    const onResize = () => {
      if (window.innerWidth > 920) closeMenu();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
    };
  }, [menuOpen, closeMenu]);

  function joinTrigger(className: string | undefined, children: ReactNode) {
    return (
      <button
        type="button"
        className={className}
        onClick={(event) => {
          closeMenu();
          open(event.currentTarget);
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <header className="header">
      <div className="nav-shell">
        <a className="brand" href="#top" aria-label="Spotlight home">
          <img src={LOGO} alt="Spotlight" width={200} height={72} />
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          {siteNav.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          {joinTrigger('button small light', <>Find your Spotlight <ArrowIcon /></>)}
          <button
            ref={toggleRef}
            type="button"
            className="menu-toggle"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-controls="mobile-menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
      <nav ref={menuRef} className="mobile-nav" id="mobile-menu" aria-label="Mobile navigation" hidden={!menuOpen}>
        {siteNav.map((item) => (
          <a key={item.href} href={item.href} onClick={closeMenu}>
            {item.label}
          </a>
        ))}
        {joinTrigger(undefined, 'Find your Spotlight ↗')}
      </nav>
    </header>
  );
}
