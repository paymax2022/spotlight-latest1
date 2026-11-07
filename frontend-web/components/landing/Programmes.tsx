'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { programmePaths } from './content';
import { ArrowIcon, SparkIcon } from './Icons';
import { onProgrammeSelect } from './programmeBus';

export default function Programmes() {
  const [active, setActive] = useState(programmePaths[0].key);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const world = programmePaths.find((path) => path.key === active) ?? programmePaths[0];

  // The hero tiles pick a tab, and the browser can land here with #programmes
  // already in the address bar; both arrive through this setter.
  useEffect(() => onProgrammeSelect(setActive), []);

  function move(index: number) {
    setActive(programmePaths[index].key);
    tabs.current[index]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        move((index + 1) % programmePaths.length);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move((index + programmePaths.length - 1) % programmePaths.length);
        break;
      case 'Home':
        event.preventDefault();
        move(0);
        break;
      case 'End':
        event.preventDefault();
        move(programmePaths.length - 1);
        break;
    }
  }

  return (
    <section className="programmes paper" id="programmes" aria-labelledby="programmes-title">
      <div className="wrap">
        <div className="section-head">
          <div>
            <p className="eyebrow dark">01 / CHOOSE YOUR WORLD</p>
            <h2 id="programmes-title">
              Different talents.
              <br />
              <em>One Spotlight.</em>
            </h2>
          </div>
          <div className="section-intro">
            <span className="mini-symbol" aria-hidden="true">
              <SparkIcon />
            </span>
            <p>
              A platform built to discover, develop and connect emerging talent. Find the programme that speaks to your
              ambition.
            </p>
          </div>
        </div>

        <div className="programme-tabs" role="tablist" aria-label="Spotlight programmes">
          {programmePaths.map((path, index) => (
            <button
              key={path.key}
              type="button"
              role="tab"
              id={`tab-${path.key}`}
              aria-controls="programme-panel"
              aria-selected={path.key === active}
              tabIndex={path.key === active ? 0 : -1}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              onClick={() => setActive(path.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span>{path.number}</span> {path.tab}
            </button>
          ))}
        </div>

        <article
          className="programme-panel"
          id="programme-panel"
          role="tabpanel"
          aria-labelledby={`tab-${world.key}`}
          tabIndex={0}
          style={{ '--programme-accent': world.accent } as CSSProperties}
        >
          <div className="programme-photo">
            <img src={world.image} alt={world.alt} loading="lazy" decoding="async" width={1536} height={1024} />
            <span className="photo-label">
              <span>{world.label}</span>
              <small>ILLUSTRATIVE PROGRAMME IMAGE</small>
            </span>
            <span className="photo-index" aria-hidden="true">
              {world.number}
            </span>
          </div>
          <div className="programme-copy">
            <p className="eyebrow">{world.kicker}</p>
            <h3>
              {world.title[0]}
              <br />
              {world.title[1]}
            </h3>
            <p>{world.description}</p>
            <ul className="programme-tags">
              {world.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
            <div className="programme-detail">
              <span>YOUR NEXT MOVE</span>
              <p>{world.next}</p>
            </div>
            {world.external ? (
              <a className="button ink" href={world.href} target="_blank" rel="noopener noreferrer">
                {world.action} <ArrowIcon />
              </a>
            ) : (
              <Link className="button ink" href={world.href}>
                {world.action} <ArrowIcon />
              </Link>
            )}
          </div>
        </article>

        <div className="programme-foot">
          <span>ONE AMBITION. YOUR OWN DIRECTION.</span>
          <p>Programme schedules and entry requirements vary. Check the current details before applying.</p>
        </div>
      </div>
    </section>
  );
}
