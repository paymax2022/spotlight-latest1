'use client';

import { useEffect } from 'react';

/**
 * Motion only: scroll reveal, the hero spotlight that follows the pointer, and a
 * one-open-at-a-time FAQ.
 *
 * Nothing here is needed to see the page. The server renders every section
 * already visible, and this effect opts the root into animation before hiding
 * anything — so a browser with JS off, an error in this file, or a slow
 * connection all show the full content rather than a blank page.
 */
export default function AcademyMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-academy-root]');
    if (!root) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cleanups: Array<() => void> = [];

    if (!reduced && 'IntersectionObserver' in window) {
      root.dataset.animate = 'on';
      const targets = Array.from(root.querySelectorAll('[data-reveal]'));
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.setAttribute('data-revealed', '');
            observer.unobserve(entry.target);
          }
        },
        { threshold: 0.08, rootMargin: '0px 0px 50px 0px' },
      );
      targets.forEach((target) => observer.observe(target));
      cleanups.push(() => observer.disconnect());
    }

    const hero = root.querySelector<HTMLElement>('[data-hero-visual]');
    if (hero && !reduced && window.matchMedia('(pointer:fine)').matches) {
      let painted = false;
      let x = 58;
      let y = 42;
      const move = (event: PointerEvent) => {
        const box = hero.getBoundingClientRect();
        x = ((event.clientX - box.left) / box.width) * 100;
        y = ((event.clientY - box.top) / box.height) * 100;
        if (painted) return;
        painted = true;
        window.requestAnimationFrame(() => {
          hero.style.setProperty('--pointer-x', `${x.toFixed(1)}%`);
          hero.style.setProperty('--pointer-y', `${y.toFixed(1)}%`);
          painted = false;
        });
      };
      const leave = () => {
        hero.style.setProperty('--pointer-x', '58%');
        hero.style.setProperty('--pointer-y', '42%');
      };
      hero.addEventListener('pointermove', move, { passive: true });
      hero.addEventListener('pointerleave', leave);
      cleanups.push(() => {
        hero.removeEventListener('pointermove', move);
        hero.removeEventListener('pointerleave', leave);
      });
    }

    // <details> already works for keyboard and screen readers; this only makes
    // the list collapse one at a time.
    const items = Array.from(root.querySelectorAll<HTMLDetailsElement>('[data-faq] details'));
    const collapse = (event: Event) => {
      const opened = event.target as HTMLDetailsElement;
      if (!opened.open) return;
      items.forEach((other) => {
        if (other !== opened) other.open = false;
      });
    };
    items.forEach((item) => item.addEventListener('toggle', collapse));
    cleanups.push(() => items.forEach((item) => item.removeEventListener('toggle', collapse)));

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  return null;
}
