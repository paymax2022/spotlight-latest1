'use client';
import Link from 'next/link';
import { useState } from 'react';

const serviceMenuItems = [
  { label: 'STEM & TECH', href: '/service-details/stem-contest' },
  { label: 'Entertainment', href: '/service-details/reality-tv-show' },
  { label: 'Sports', href: '/service-details/sports' },
  { label: 'SME Funding', href: '/service-details/sme-pitch-contest' },
];

export default function MobileMenu() {
  const [activeItem, setActiveItem] = useState(1);

  const handleActiveItem = (index) => {
    setActiveItem(index);
  };

  return (
    <div className="mobile-menu fix mb-3 mean-container">
      <div className="mean-bar">
        <Link href="/#nav" className="meanmenu-reveal" style={{ right: 0, left: 'auto', display: 'inline' }}>
          <span>
            <span><span /></span>
          </span>
        </Link>
        <nav className="mean-nav">
          <ul>
            <li>
              <Link href="/">Home</Link>
            </li>

            <li>
              <Link href="/about">About</Link>
            </li>

            <li>
              <Link href="/season-2">Season 2</Link>
            </li>

            <li>
              <button
                type="button"
                className="menu-group"
                aria-expanded={activeItem === 2}
                onClick={() => handleActiveItem(activeItem === 2 ? 0 : 2)}
              >
                Programes
                <i className="fas fa-angle-down" />
              </button>
              <ul className="submenu" style={{ display: `${activeItem === 2 ? 'block' : 'none'}` }}>
                {serviceMenuItems.map((item) => (
                  <li key={item.href}><Link href={item.href}>{item.label}</Link></li>
                ))}
              </ul>
              <a className={`mean-expand ${activeItem === 2 ? 'mean-clicked' : ''}`} onClick={() => handleActiveItem(2)}>
                <i className="far fa-plus" />
              </a>
            </li>

            <li className="mean-last">
              <Link href="/contact">Contact Us</Link>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
