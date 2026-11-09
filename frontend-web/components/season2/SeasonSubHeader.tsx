'use client';

import { useEffect, useRef } from 'react';
import { ArrowIcon } from './Icons';
import { seasonNav } from './content';
import { useRegistrationPanel } from './RegistrationPanel';

/**
 * The season's own sticky rail, kept under the site chrome so people can still
 * jump to the recap sections and open the registration panel from /season-2.
 *
 * Both the template header and this rail change height with the viewport, so
 * their real heights are measured and published on <html>: `--season-rail-top`
 * pins the rail under the header, and `--season-chrome-top` feeds the CSS
 * `scroll-padding-top` so anchor jumps clear both of them.
 */
export default function SeasonSubHeader() {
  const { open } = useRegistrationPanel();
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sticky = document.getElementById('header-sticky');
    const rail = railRef.current;
    if (!sticky || !rail) return;
    const sync = () => {
      const root = document.documentElement.style;
      root.setProperty('--season-rail-top', `${sticky.offsetHeight}px`);
      root.setProperty('--season-chrome-top', `${sticky.offsetHeight + rail.offsetHeight}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(sticky);
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="season-subheader" ref={railRef}>
      <div className="wrap">
        <nav aria-label="Season navigation">
          {seasonNav.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <button
          type="button"
          className="button light"
          onClick={(event) => open(event.currentTarget)}
        >
          Register <ArrowIcon />
        </button>
      </div>
    </div>
  );
}
