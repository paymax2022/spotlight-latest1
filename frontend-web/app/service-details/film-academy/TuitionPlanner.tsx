'use client';

import { useState } from 'react';
import type { AcademyCatalogueArea } from '@/src/server/services/academy/catalogue';
import type { AcademyPricingKey } from '@/src/server/services/academy/pricing';
import styles from './academy.module.css';
import { ApplyLink } from './ApplyDrawer';
import { ACADEMY_CONTACT, ACADEMY_PAYMENTS } from './contact';
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
 * The area/format picker, plus the programme's payment terms.
 *
 * Tuition is flat (ACADEMY_PAYMENTS), so the per-area estimate this card used
 * to compute from the stored format prices is gone: what an applicant chooses
 * decides WHAT they train in, not what they pay. Registration is free and
 * tuition is settled offline — weekly at the venue, or by bank transfer — so
 * nothing on this card is a charge the platform takes. What is actually owed
 * is still computed server-side at submit (`api/academy/apply/route.ts`).
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
  const full = chosen.length >= maxAreas;

  const toggle = (slug: string) => {
    setSelections((current) => {
      const next = { ...current };
      if (next[slug]) {
        delete next[slug];
        return next;
      }
      if (Object.keys(next).length >= maxAreas) return current;
      // Default to the area's first listed format.
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
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className={styles.formatsHidden}>Tap to choose a format</p>
                )}
              </div>
            );
          })}
        </div>

        <aside className={styles.totalCard}>
          <h3>Your tuition</h3>
          <span className={styles.totalFigure}>{formatNaira(ACADEMY_PAYMENTS.tuitionNgn)}</span>
          <p className={styles.totalNote}>
            One flat programme tuition — what you choose decides what you train in, not what you pay.
          </p>

          <p className={styles.feeNote}>
            {applicationFeeNgn === null ? (
              'Admissions confirms the application fee before you pay anything.'
            ) : applicationFeeNgn === 0 ? (
              'Registration is free — no payment is taken to apply.'
            ) : (
              <>
                <b>{formatNaira(applicationFeeNgn)}</b> application fee
                {applicationFeeRefundable === false ? ' (non-refundable)' : ''} is charged with your first tuition
                instalment when you submit — one payment, and your lessons open straight away.
              </>
            )}
          </p>

          <div className={styles.exclusions}>
            <b>How tuition is paid</b>
            <p>
              Tuition can be paid in instalments — {formatNaira(ACADEMY_PAYMENTS.weeklyNgn)} per week, at the Film
              Academy venue ({ACADEMY_CONTACT.address.join(', ')}) or by bank transfer to{' '}
              {ACADEMY_PAYMENTS.bankName}, Account: {ACADEMY_PAYMENTS.accountNumber}.
            </p>
          </div>

          {feeExclusions.length > 0 ? (
            <div className={styles.exclusions}>
              <b>Tuition does not cover:</b>
              {feeExclusions.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}

          <div className={styles.panelActions}>
            <ApplyLink className={styles.action}>
              Apply for a training plan <span aria-hidden="true">↗</span>
            </ApplyLink>
          </div>
        </aside>
      </div>
    </>
  );
}
