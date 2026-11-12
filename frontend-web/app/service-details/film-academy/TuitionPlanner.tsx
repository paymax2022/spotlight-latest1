'use client';

import { useState } from 'react';
import type { AcademyCatalogueArea } from '@/src/server/services/academy/catalogue';
import type { AcademyPricingKey } from '@/src/server/services/academy/pricing';
import styles from './academy.module.css';
import { ApplyLink } from './ApplyDrawer';
import { formatNaira } from './format';

type Selections = Record<string, AcademyPricingKey>;

interface Props {
  areas: AcademyCatalogueArea[];
  maxAreas: number;
  applicationFeeNgn: number | null;
  applicationFeeRefundable: boolean | null;
  feeExclusions: string[];
}

/**
 * A tuition estimate from the same rows the application endpoint prices:
 * pick up to `maxAreas` areas, choose one format each, and the total is the sum
 * of the stored per-area prices.
 *
 * The number shown here is an estimate the visitor can reason about. What is
 * actually owed is computed server-side at submit — the client is not what
 * decides (`api/academy/apply/route.ts`), which is why the card says so.
 */
export default function TuitionPlanner({
  areas,
  maxAreas,
  applicationFeeNgn,
  applicationFeeRefundable,
  feeExclusions,
}: Props) {
  const [selections, setSelections] = useState<Selections>({});

  const chosen = areas.filter((area) => selections[area.slug]);
  const total = chosen.reduce(
    (sum, area) => sum + (area.pricing_options.find((o) => o.key === selections[area.slug])?.price_ngn ?? 0),
    0,
  );
  const full = chosen.length >= maxAreas;

  const toggle = (slug: string) => {
    setSelections((current) => {
      const next = { ...current };
      if (next[slug]) {
        delete next[slug];
        return next;
      }
      if (Object.keys(next).length >= maxAreas) return current;
      // Default to the area's first listed format, which is its cheapest.
      const first = areas.find((item) => item.slug === slug)?.pricing_options[0];
      if (!first) return current;
      next[slug] = first.key;
      return next;
    });
  };

  return (
    <>
      <div className={styles.planGrid}>
        <div className={styles.picker}>
          <p className={styles.pickerHead}>
            Choose up to {maxAreas} areas — one format each
          </p>
          {areas.map((area) => {
            const key = selections[area.slug];
            const selected = Boolean(key);
            return (
              <div className={styles.areaRow} key={area.slug}>
                <div className={styles.areaHead}>
                  <button
                    type="button"
                    className={`${styles.areaCheck} ${selected ? styles.areaCheckOn : ''}`}
                    aria-pressed={selected}
                    disabled={!selected && full}
                    onClick={() => toggle(area.slug)}
                  >
                    <span className={styles.box} aria-hidden="true">
                      {selected ? '✓' : ''}
                    </span>
                    <span className={styles.areaLabel}>{area.label}</span>
                  </button>
                </div>

                {selected ? (
                  <div className={styles.formats} role="group" aria-label={`Training format for ${area.label}`}>
                    {area.pricing_options.map((option) => (
                      <button
                        type="button"
                        key={option.key}
                        className={`${styles.format} ${option.key === key ? styles.formatOn : ''}`}
                        aria-pressed={option.key === key}
                        onClick={() => setSelections((current) => ({ ...current, [area.slug]: option.key }))}
                      >
                        {option.label}
                        <b>{formatNaira(option.price_ngn)}</b>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className={styles.formatsHidden}>
                    From {formatNaira(Math.min(...area.pricing_options.map((o) => o.price_ngn)))}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <aside className={styles.totalCard}>
          <h3>Your estimate</h3>
          <span className={styles.totalFigure}>{formatNaira(total)}</span>
          <p className={styles.totalNote}>
            {chosen.length === 0
              ? 'Select an area above to price a training plan.'
              : `Tuition for ${chosen.length} ${chosen.length === 1 ? 'area' : 'areas'}.`}
          </p>

          {chosen.length > 0 ? (
            <ul className={styles.totalList}>
              {chosen.map((area) => {
                const option = area.pricing_options.find((o) => o.key === selections[area.slug]);
                return (
                  <li key={area.slug}>
                    <span>
                      {area.label} — {option?.label ?? '—'}
                    </span>
                    <b>{formatNaira(option?.price_ngn ?? 0)}</b>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <p className={styles.feeNote}>
            {applicationFeeNgn === null ? (
              'Admissions confirms the application fee before you pay anything.'
            ) : applicationFeeNgn === 0 ? (
              'Application is free — no payment is taken to apply.'
            ) : (
              <>
                <b>{formatNaira(applicationFeeNgn)}</b> application fee
                {applicationFeeRefundable === false ? ' (non-refundable)' : ''} is charged with your first tuition
                instalment when you submit — one payment, and your lessons open straight away.
              </>
            )}
          </p>

          <div className={styles.exclusions}>
            <b>Tuition does not cover:</b>
            {feeExclusions.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>

          <div className={styles.panelActions}>
            <ApplyLink className={styles.action}>
              Apply for a training plan <span aria-hidden="true">↗</span>
            </ApplyLink>
          </div>
        </aside>
      </div>

      <div className={styles.matrixWrap} tabIndex={0} role="region" aria-label="Full tuition matrix, scrollable">
        <table className={styles.matrix}>
          <caption>Every area and format, as priced by admissions</caption>
          <thead>
            <tr>
              <th scope="col">Area of study</th>
              {areas[0]?.pricing_options.map((option) => (
                <th scope="col" key={option.key}>
                  {option.label}
                  {option.note ? <span className={styles.priceRowNote}>{option.note}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {areas.map((area) => (
              <tr key={area.slug}>
                <th scope="row" className={styles.matrixArea}>
                  {area.label}
                </th>
                {area.pricing_options.map((option) => (
                  <td
                    key={option.key}
                    className={selections[area.slug] === option.key ? styles.matrixPick : undefined}
                  >
                    {formatNaira(option.price_ngn)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
