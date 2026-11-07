'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { patrons, type Person } from './content';

const STEP_PER_FRAME = 0.028;
/** The gap `.people-group` leaves between the duplicated halves of the track. */
const GROUP_GAP = 22;
const MANUAL_SCROLL = 290;

export default function PeopleRail() {
  const railRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  // The animation loop runs for the life of the page, so everything it reads
  // lives in refs rather than state it would have to re-subscribe to.
  const pausedRef = useRef(paused);
  const hovered = useRef(false);
  const focused = useRef(false);
  const onScreen = useRef(true);

  const pause = useCallback(() => setPaused(true), []);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduce.matches) setPaused(true);

    const rail = railRef.current;
    const group = groupRef.current;
    if (!rail || !group) return;

    const observer = new IntersectionObserver(
      (entries) => {
        onScreen.current = entries[0].isIntersecting;
      },
      { threshold: 0.05 },
    );
    observer.observe(rail);

    const onEnter = () => (hovered.current = true);
    const onLeave = () => (hovered.current = false);
    const onFocusIn = () => (focused.current = true);
    const onFocusOut = () => (focused.current = false);

    rail.addEventListener('pointerenter', onEnter);
    rail.addEventListener('pointerleave', onLeave);
    rail.addEventListener('focusin', onFocusIn);
    rail.addEventListener('focusout', onFocusOut);
    rail.addEventListener('touchstart', pause, { passive: true });
    rail.addEventListener('wheel', pause, { passive: true });

    let last = 0;
    let frame = requestAnimationFrame(function animate(now: number) {
      const delta = Math.min(now - last, 50);
      last = now;
      const width = group.getBoundingClientRect().width + GROUP_GAP;
      if (onScreen.current && !pausedRef.current && !hovered.current && !focused.current && !document.hidden) {
        rail.scrollLeft += delta * STEP_PER_FRAME;
        if (rail.scrollLeft >= width) rail.scrollLeft -= width;
      }
      frame = requestAnimationFrame(animate);
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      rail.removeEventListener('pointerenter', onEnter);
      rail.removeEventListener('pointerleave', onLeave);
      rail.removeEventListener('focusin', onFocusIn);
      rail.removeEventListener('focusout', onFocusOut);
      rail.removeEventListener('touchstart', pause);
      rail.removeEventListener('wheel', pause);
    };
  }, [pause]);

  function scrollByHalf(direction: number) {
    const rail = railRef.current;
    const group = groupRef.current;
    if (!rail || !group) return;
    setPaused(true);
    const width = group.getBoundingClientRect().width + GROUP_GAP;
    // Stepping back from the very start has to land on the copy that trails the
    // original group, or the visitor runs into dead space.
    if (direction < 0 && rail.scrollLeft < 3) rail.scrollLeft = width;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rail.scrollBy({ left: direction * MANUAL_SCROLL, behavior: reduce ? 'instant' : 'smooth' });
  }

  return (
    <section className="people-section" id="community" aria-labelledby="people-title">
      <div className="wrap">
        <div className="section-head">
          <div>
            <p className="eyebrow">04 / PATRONS, INFLUENCERS &amp; SUPPORTERS</p>
            <h2 id="people-title">
              Big names.
              <br />
              <em>Shared belief.</em>
            </h2>
          </div>
          <div className="people-intro">
            <p>Meet the patrons and supporters featured by Spotlight. A community spanning music, comedy, film and influence.</p>
            <div className="rail-controls">
              <button
                type="button"
                className="rail-pause"
                aria-pressed={paused}
                onClick={() => setPaused((current) => !current)}
              >
                {paused ? 'Resume scrolling' : 'Pause scrolling'}
              </button>
              <button type="button" className="round-control" aria-label="Previous supporters" onClick={() => scrollByHalf(-1)}>
                ←
              </button>
              <button type="button" className="round-control" aria-label="Next supporters" onClick={() => scrollByHalf(1)}>
                →
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={railRef}
        className="people-rail"
        tabIndex={0}
        role="region"
        aria-label="Scrolling gallery of patrons and supporters"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            scrollByHalf(1);
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            scrollByHalf(-1);
          }
        }}
      >
        <div className="people-track">
          <div ref={groupRef} className="people-group">
            {patrons.map((person) => (
              <PersonCard key={person.name} person={person} />
            ))}
          </div>
          {/* The rail wraps by scrolling, so the second group is the same cards;
              screen readers already heard the first. */}
          <div className="people-group" aria-hidden="true">
            {patrons.map((person) => (
              <PersonCard key={person.name} person={person} blankAlt />
            ))}
          </div>
        </div>
      </div>

      <div className="wrap people-footer">
        <span>PATRONS / ENTERTAINERS / SUPPORTERS</span>
        <p>
          Portraits and listed roles follow{' '}
          <Link href="/about">Spotlight’s published patron and supporter listings</Link>.
        </p>
      </div>
    </section>
  );
}

function PersonCard({ person, blankAlt = false }: { person: Person; blankAlt?: boolean }) {
  return (
    <article className="person-card">
      <img
        src={person.image}
        alt={blankAlt ? '' : `${person.name} — ${person.role}`}
        loading="lazy"
        decoding="async"
      />
      <span className="person-tag">{person.category}</span>
      <div className="person-copy">
        <h3>{person.name}</h3>
        <p>{person.role}</p>
      </div>
    </article>
  );
}
