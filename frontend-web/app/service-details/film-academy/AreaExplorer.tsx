'use client';

import { useState } from 'react';
import type { AcademyCatalogueArea } from '@/src/server/services/academy/catalogue';
import styles from './academy.module.css';
import { ApplyLink } from './ApplyDrawer';
import { whatsappEnquiry } from './contact';
import { formatNaira } from './format';

const tabId = (index: number) => `area-tab-${index}`;

/**
 * The areas of study, read from `academy_interest_areas` — the same rows the
 * application endpoint prices against. The list, the descriptions and the five
 * format prices per area all come from the admin-managed tables, so nothing here
 * can drift from what an applicant is actually charged.
 */
export default function AreaExplorer({ areas }: { areas: AcademyCatalogueArea[] }) {
  const [index, setIndex] = useState(0);
  const area = areas[index];
  if (!area) return null;

  const move = (event: React.KeyboardEvent<HTMLButtonElement>, from: number) => {
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (from + 1) % areas.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (from - 1 + areas.length) % areas.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = areas.length - 1;
    else return;

    event.preventDefault();
    setIndex(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <div className={styles.explorer}>
      <div className={styles.tabs} role="tablist" aria-label="Areas of study" aria-orientation="vertical">
        {areas.map((item, i) => (
          <button
            key={item.slug}
            id={tabId(i)}
            type="button"
            role="tab"
            className={`${styles.tab} ${i === index ? styles.tabActive : ''}`}
            aria-selected={i === index}
            aria-controls="area-panel"
            tabIndex={i === index ? 0 : -1}
            onClick={() => setIndex(i)}
            onKeyDown={(event) => move(event, i)}
          >
            <small>{String(i + 1).padStart(2, '0')}</small>
            <span>{item.label}</span>
            <span className={styles.tabArrow} aria-hidden="true">
              ↗
            </span>
          </button>
        ))}
      </div>

      <article className={styles.panel} id="area-panel" role="tabpanel" tabIndex={0} aria-labelledby={tabId(index)}>
        <div className={styles.panelArt}>
          {/* Editorial illustration, not documentary footage of the academy. */}
          <img src="/assets/img/film-academy/on-set.jpg" alt={`Trainees working on a film set — illustrative image for ${area.label}`} loading="lazy" />
          <span className={styles.panelGlyph} aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className={styles.imageNote}>ILLUSTRATIVE IMAGE · NOT FOOTAGE FROM THIS COHORT</span>
        </div>

        <div className={styles.panelCopy}>
          <p className={styles.label}>Area of study</p>
          <h3>{area.label}</h3>
          {area.description ? <p>{area.description}</p> : null}

          <div className={styles.priceLines}>
            <p className={styles.priceHead}>
              <span>Training formats</span>
              <span>Tuition</span>
            </p>
            <dl>
              {area.pricing_options.map((option) => (
                <div className={styles.priceRow} key={option.key}>
                  <dt>
                    {option.label}
                    {option.note ? <span className={styles.priceRowNote}>{option.note}</span> : null}
                  </dt>
                  <dd>{formatNaira(option.price_ngn)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className={styles.panelActions}>
            <a
              className={styles.action}
              href={whatsappEnquiry(`Hello Spotlight, I would like to enquire about ${area.label} training at the Film Academy.`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Enquire about {area.label} <span aria-hidden="true">↗</span>
            </a>
            <ApplyLink className={`${styles.action} ${styles.actionGhost}`}>
              Apply <span aria-hidden="true">↗</span>
            </ApplyLink>
          </div>
        </div>
      </article>
    </div>
  );
}
