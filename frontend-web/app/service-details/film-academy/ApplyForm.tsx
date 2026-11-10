'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authHeaders } from '@/src/lib/auth/client';
import { createClient } from '@/src/lib/supabase/client';
import { loadPaystackClient } from '@/src/lib/payments';
import { formatNaira, formatProgrammeDate, intakePhase, scheduleLabel } from './format';
import styles from './apply.module.css';

type Batch = {
  id: string; batch_name: string; start_date: string; status: string;
  training_schedule: string; duration_weeks: number; description: string;
  training_fee_ngn?: number | null; installments_count?: number | null;
  fee_frequency?: string | null; one_off_discount_pct?: number | null;
};

/** What the account already holds; shown read-only rather than asked for again. */
type Applicant = { full_name: string; email: string; phone: string };

type AcademySettings = {
  registration_type: 'free' | 'paid';
  application_fee: number;
  application_fee_refundable: boolean;
};

type PricingOption = { key: string; label: string; note: string | null; price_ngn: number; sort_order: number };
type PricingFormat = { key: string; label: string; note: string | null; sort_order: number };
type InterestArea = {
  slug: string;
  label: string;
  description: string | null;
  fee_ngn: number;
  pricing_options?: PricingOption[];
};

type Step = 'select' | 'form' | 'done';

type ApplicationForm = {
  batch_id: string;
  full_name: string;
  email: string;
  phone: string;
  areas_of_interest: string[];
  motivation: string;
  experience: string;
  payment_preference: 'one_off' | 'installment';
};

const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'select', label: 'Intake' },
  { key: 'form', label: 'Application' },
  { key: 'done', label: 'Submitted' },
];

function Chevron() {
  return (
    <svg className={styles.chevron} viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M1 1.5 6 6.5 11 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 6v5M10 13.6v.4" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3.2" y="7" width="9.6" height="6.4" rx="1.6" />
      <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
    </svg>
  );
}

interface Props {
  prefillBatch: string;
  onClose: () => void;
}

/**
 * The admissions application, priced and validated by /api/academy/apply — the
 * same endpoint the mobile app uses. Every commercial number here (fees, the
 * per-application area cap, deliverables, exclusions) is server-owned; the
 * client only mirrors it, and the server recomputes the charge at submit.
 */
export default function ApplyForm({ prefillBatch, onClose }: Props) {
  const router = useRouter();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [appliedBatchIds, setAppliedBatchIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<AcademySettings>({
    registration_type: 'free',
    application_fee: 0,
    application_fee_refundable: false,
  });
  const [interestAreas, setInterestAreas] = useState<InterestArea[]>([]);
  const [batchAreas, setBatchAreas] = useState<Record<string, string[]>>({});
  const [maxInterestAreas, setMaxInterestAreas] = useState(2);
  const [pricingStructure, setPricingStructure] = useState<PricingFormat[]>([]);
  const [deliverables, setDeliverables] = useState<string[]>([]);
  const [feeExclusions, setFeeExclusions] = useState<string[]>([]);
  // Presence in this map means the area is selected, keyed to the price line
  // tapped. An empty key only occurs on a server without the format table.
  const [areaSelections, setAreaSelections] = useState<Record<string, string>>({});
  const [openAreaSlug, setOpenAreaSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [signedIn, setSignedIn] = useState(true);
  const [step, setStep] = useState<Step>(prefillBatch ? 'form' : 'select');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [applicant, setApplicant] = useState<Applicant | null>(null);
  // A charge that succeeded but whose submit failed — reused, never re-taken.
  const [paidFeeReference, setPaidFeeReference] = useState('');
  const [attempt, setAttempt] = useState(0);

  const [form, setFormState] = useState<ApplicationForm>({
    batch_id: prefillBatch,
    full_name: '', email: '', phone: '',
    areas_of_interest: [],
    motivation: '', experience: '',
    payment_preference: 'installment',
  });

  // Editing any field retires the last rejection, so a corrected answer is never
  // still sitting under a message saying it is wrong.
  const setForm = useCallback((next: React.SetStateAction<ApplicationForm>) => {
    setError('');
    setFormState(next);
  }, []);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  const signIn = useCallback(() => {
    const target = `${window.location.pathname}${window.location.search}`;
    router.push(`/login?next=${encodeURIComponent(target)}`);
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled) return;
        setSignedIn(Boolean(user));

        const res = await fetch('/api/academy/apply', { headers: await authHeaders() });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(json?.error || 'The admissions catalogue could not be loaded.');

        const appliedIds = Array.isArray(json.appliedBatchIds) ? json.appliedBatchIds : [];
        setBatches(Array.isArray(json.batches) ? json.batches : []);
        setAppliedBatchIds(appliedIds);
        setInterestAreas(Array.isArray(json.interestAreas) ? json.interestAreas : []);
        setBatchAreas(json.batchAreas && typeof json.batchAreas === 'object' ? json.batchAreas : {});
        setMaxInterestAreas(Number.isFinite(json.maxInterestAreas) ? json.maxInterestAreas : 2);
        setPricingStructure(Array.isArray(json.pricingStructure) ? json.pricingStructure : []);
        setDeliverables(Array.isArray(json.deliverables) ? json.deliverables : []);
        setFeeExclusions(Array.isArray(json.feeExclusions) ? json.feeExclusions : []);

        if (json.applicant) {
          const known = json.applicant as Applicant;
          setApplicant(known);
          // Never clobber anything already typed — this resolves after the form
          // is interactive.
          setForm((p) => ({
            ...p,
            full_name: p.full_name || known.full_name || '',
            email: p.email || known.email || '',
            phone: p.phone || known.phone || '',
          }));
        }
        if (json.settings) {
          setSettings({
            registration_type: json.settings.registration_type === 'paid' ? 'paid' : 'free',
            application_fee: Number(json.settings.application_fee ?? 0),
            application_fee_refundable: json.settings.application_fee_refundable === true,
          });
        }

        if (prefillBatch && appliedIds.includes(prefillBatch)) {
          setForm((p) => ({ ...p, batch_id: '' }));
          setStep('select');
          setError('You have already applied for this Film Academy intake.');
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'The admissions catalogue could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [prefillBatch, attempt, setForm]);

  // Each step change starts at the top of the drawer, and a rejected submit
  // scrolls its message into view rather than leaving it below the fold.
  useEffect(() => {
    bodyRef.current?.parentElement?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const batch = batches.find((b) => b.id === form.batch_id);
  const selectedBatchApplied = Boolean(form.batch_id && appliedBatchIds.includes(form.batch_id));
  const applicationFeeDue = settings.registration_type === 'paid' ? settings.application_fee : 0;
  const submitDisabled = submitting || selectedBatchApplied;

  // Only the areas THIS intake offers. An empty entry means it runs no
  // trainings yet; only a wholly absent entry (an older server) is unrestricted.
  const offeredSlugs = form.batch_id ? batchAreas[form.batch_id] : undefined;
  const availableAreas = offeredSlugs === undefined
    ? interestAreas
    : interestAreas.filter((a) => offeredSlugs.includes(a.slug));
  const atLimit = form.areas_of_interest.length >= maxInterestAreas;

  const hasStructure = pricingStructure.length > 0
    && availableAreas.some((a) => (a.pricing_options?.length ?? 0) > 0);
  const priceOf = (a: InterestArea): number => hasStructure
    ? (a.pricing_options ?? []).find((o) => o.key === areaSelections[a.slug])?.price_ngn ?? 0
    : Number(a.fee_ngn ?? 0);
  const tuitionTotal = availableAreas
    .filter((a) => form.areas_of_interest.includes(a.slug))
    .reduce((sum, a) => sum + priceOf(a), 0);

  // ONE charge at submit: application fee + the FIRST tuition instalment.
  // Mirrors tuitionPlanShape on the server, which verifies it.
  const billedTuition = tuitionTotal > 0 ? tuitionTotal : Number(batch?.training_fee_ngn ?? 0);
  const payUpfront = form.payment_preference === 'one_off'
    || !['weekly', 'biweekly', 'monthly'].includes(String(batch?.fee_frequency ?? 'monthly'));
  const instalmentCount = payUpfront ? 1 : Math.min(12, Math.max(1, Number(batch?.installments_count ?? 1)));
  const discountPct = form.payment_preference === 'one_off' ? Number(batch?.one_off_discount_pct ?? 0) : 0;
  const discountedTuition = Math.round(billedTuition * (1 - discountPct / 100) * 100) / 100;
  const firstTuitionDue = billedTuition > 0
    ? (instalmentCount === 1 ? discountedTuition : Math.round((discountedTuition / instalmentCount) * 100) / 100)
    : 0;
  // Mirrors expectedTotalPayment on the server: a free programme owes nothing at
  // submit, so its tuition is recorded and invoiced by admissions instead.
  const payNow = settings.registration_type === 'paid' ? applicationFeeDue + firstTuitionDue : 0;
  const registrationFeeRequired = payNow > 0;
  const chargeParts = [
    applicationFeeDue > 0 ? 'your application fee' : '',
    instalmentCount > 1 ? 'your first tuition instalment' : 'your tuition',
  ].filter(Boolean).join(' and ');

  function pickSub(slug: string, key: string) {
    setForm((p) => {
      const current = p.areas_of_interest;
      if (current.includes(slug) && areaSelections[slug] === key) {
        setAreaSelections((prev) => {
          const next = { ...prev };
          delete next[slug];
          return next;
        });
        return { ...p, areas_of_interest: current.filter((a) => a !== slug) };
      }
      if (!current.includes(slug) && current.length >= maxInterestAreas) return p;
      setAreaSelections((prev) => ({ ...prev, [slug]: key }));
      return { ...p, areas_of_interest: current.includes(slug) ? current : [...current, slug] };
    });
  }

  // Server without the format table: the area row itself selects.
  function toggleArea(slug: string) {
    setForm((p) => {
      const on = p.areas_of_interest.includes(slug);
      if (on) {
        setAreaSelections((prev) => {
          const next = { ...prev };
          delete next[slug];
          return next;
        });
        return { ...p, areas_of_interest: p.areas_of_interest.filter((a) => a !== slug) };
      }
      if (p.areas_of_interest.length >= maxInterestAreas) return p;
      setAreaSelections((prev) => ({ ...prev, [slug]: '' }));
      return { ...p, areas_of_interest: [...p.areas_of_interest, slug] };
    });
  }

  function selectBatch(batchId: string) {
    if (appliedBatchIds.includes(batchId)) {
      setError('You have already applied for this Film Academy intake.');
      return;
    }
    setError('');
    setForm((p) => ({ ...p, batch_id: batchId }));
    setStep('form');
  }

  function validateForm() {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.batch_id) return 'Choose the intake you want to join.';
    if (selectedBatchApplied) return 'You have already applied for this intake. Choose another one.';
    if (!form.full_name.trim()) return 'Your full name is required.';
    if (!form.email.trim() || !emailPattern.test(form.email.trim())) return 'A valid email address is required.';
    if (!form.phone.trim()) return 'A phone number is required.';
    if (form.areas_of_interest.length === 0) return 'Open a training, then tap its price line to choose it.';
    if (form.areas_of_interest.length > maxInterestAreas) {
      return `Choose at most ${maxInterestAreas} areas of study for this intake.`;
    }
    if (hasStructure && form.areas_of_interest.some((s) => !areaSelections[s])) {
      return 'Choose a training format for each area you selected.';
    }
    if (!form.motivation.trim()) return 'Tell admissions why you want to join.';
    return '';
  }

  async function submitApplication(applicationFeeReference?: string) {
    try {
      const res = await fetch('/api/academy/apply', {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({
          ...form,
          ...(hasStructure
            ? { area_selections: form.areas_of_interest.map((slug) => ({ slug, key: areaSelections[slug] })) }
            : {}),
          application_fee_reference: applicationFeeReference,
        }),
      });
      if (res.status === 401) {
        signIn();
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Submission failed');

      setAppliedBatchIds((current) => Array.from(new Set([...current, form.batch_id])));
      setSubmitting(false);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
      setSubmitting(false);
    }
  }

  async function payRegistrationFeeAndSubmit() {
    const headers = await authHeaders();
    if (!headers.Authorization) {
      signIn();
      return;
    }

    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';
    if (!publicKey || publicKey.includes('placeholder')) {
      setError('The payment gateway is not configured. Please contact admissions.');
      setSubmitting(false);
      return;
    }

    try {
      // Mint the reference server-side first: the initiate endpoint freezes the
      // quote against it and gives the webhook a record to fulfil if this
      // browser never submits. A Paystack-minted reference would orphan the charge.
      const initRes = await fetch('/api/academy/application-fee/initiate', {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({
          email: form.email,
          full_name: form.full_name,
          batch_id: form.batch_id,
          payment_preference: form.payment_preference,
          ...(hasStructure
            ? { area_selections: form.areas_of_interest.map((slug) => ({ slug, key: areaSelections[slug] })) }
            : { areas_of_interest: form.areas_of_interest }),
        }),
      });
      const initJson = await initRes.json().catch(() => ({}));
      if (!initRes.ok) throw new Error(initJson?.error || 'Could not start the registration payment.');
      const feeReference = String(initJson.reference ?? '');
      const amountKobo = Number(initJson.amountKobo ?? 0);
      if (!feeReference || !(amountKobo > 0)) throw new Error('Could not start the registration payment.');

      const PaystackPop = await loadPaystackClient();
      const handler = new PaystackPop();
      handler.newTransaction({
        key: publicKey,
        email: form.email,
        amount: amountKobo,
        reference: feeReference,
        currency: 'NGN',
        metadata: {
          custom_fields: [
            { display_name: 'Payment Type', variable_name: 'payment_type', value: 'Film Academy Registration Fee' },
            { display_name: 'Batch', variable_name: 'batch_name', value: batch?.batch_name ?? '' },
          ],
        },
        onSuccess: (transaction) => {
          setPaidFeeReference(transaction.reference);
          void submitApplication(transaction.reference);
        },
        onCancel: () => {
          setError('Payment is required before this application can be submitted.');
          setSubmitting(false);
        },
        onError: (paymentError) => {
          setError(paymentError.message || 'The registration payment failed.');
          setSubmitting(false);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
      setSubmitting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!signedIn) {
      signIn();
      return;
    }

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    if (registrationFeeRequired) {
      if (paidFeeReference) {
        await submitApplication(paidFeeReference);
        return;
      }
      await payRegistrationFeeAndSubmit();
      return;
    }

    await submitApplication();
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  const rail = (
    <ol className={styles.rail} aria-label="Application progress">
      {STEPS.map((s, i) => (
        <li
          key={s.key}
          className={`${styles.railStep} ${i === stepIndex ? styles.railOn : ''} ${i < stepIndex ? styles.railDone : ''}`}
          aria-current={i === stepIndex ? 'step' : undefined}
        >
          <b aria-hidden="true">{i < stepIndex ? '✓' : String(i + 1).padStart(2, '0')}</b>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );

  if (loading) {
    return (
      <div className={styles.inner} ref={bodyRef}>
        {rail}
        <div className={styles.skeleton} role="status" aria-live="polite">
          <span className={styles.label}>Reading the admissions catalogue</span>
          <div className={styles.skeletonCard} />
          <div className={styles.skeletonCard} />
          <div className={styles.skeletonCard} />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.inner} ref={bodyRef}>
        {rail}
        <div className={styles.empty}>
          <h3>Admissions is unreachable</h3>
          <p>{loadError}</p>
          <div className={styles.emptyActions}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
              Back to the academy
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.inner} ref={bodyRef}>
      {rail}

      {step === 'select' && (
        <section className={`${styles.section} ${styles.stagger}`}>
          <div>
            <p className={styles.label}>01 / Choose your intake</p>
            <h3 className={styles.sectionTitle}>Which cohort are you joining?</h3>
            <p className={styles.hint}>
              Each intake runs its own schedule and set of trainings. Pick one and the application opens with the
              areas that cohort actually teaches.
            </p>
          </div>

          {error && (
            <div className={styles.error} role="alert" ref={errorRef} style={{ marginTop: 16 }}>
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}

          {batches.length === 0 ? (
            <div className={styles.empty} style={{ marginTop: 16 }}>
              <h3>No intake is open right now</h3>
              <p>
                Admissions has not published a cohort accepting applications. Ask them when the next one opens —
                they will tell you before it goes on this page.
              </p>
              <div className={styles.emptyActions}>
                <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
                  Back to the academy
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.batchList}>
              {batches.map((b) => {
                const applied = appliedBatchIds.includes(b.id);
                const starts = formatProgrammeDate(b.start_date) ?? 'Date to be announced';
                const schedule = scheduleLabel(b.training_schedule) ?? 'Schedule to be confirmed';
                return (
                  <article key={b.id} className={`${styles.batch} ${applied ? styles.batchApplied : ''}`}>
                    <div className={styles.batchTop}>
                      <span className={styles.batchSchedule}>{intakePhase(b)}</span>
                      <span className={`${styles.pill} ${applied ? styles.pillOk : ''}`}>
                        {applied ? 'Applied' : b.status === 'ongoing' ? 'Running now' : 'Applications open'}
                      </span>
                    </div>
                    <h4 className={styles.batchName}>{b.batch_name}</h4>
                    <p className={styles.batchDesc}>
                      {b.description || 'Practical film training, production exposure and academy mentorship.'}
                    </p>
                    <dl className={styles.batchMeta}>
                      <div>
                        <dt>Starts</dt>
                        <dd>{starts}</dd>
                      </div>
                      <div>
                        <dt>Schedule</dt>
                        <dd>{schedule}</dd>
                      </div>
                      {b.duration_weeks ? (
                        <div>
                          <dt>Length</dt>
                          <dd>{b.duration_weeks} weeks</dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className={styles.batchFoot}>
                      <button
                        type="button"
                        className={`${styles.btn} ${applied ? styles.btnGhost : styles.btnPrimary}`}
                        disabled={applied}
                        onClick={() => selectBatch(b.id)}
                      >
                        {applied ? 'Already applied' : 'Apply for this intake'} <span aria-hidden="true">↗</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {step === 'done' && (
        <section className={styles.section}>
          <div className={styles.done}>
            <svg className={styles.doneMark} viewBox="0 0 66 66" aria-hidden="true">
              <circle cx="33" cy="33" r="31" />
              <path d="M21 34.5 29.5 43 46 25" />
            </svg>
            <h3>That&apos;s a wrap</h3>
            <p>
              {registrationFeeRequired
                ? 'Your payment is verified, your place is confirmed and your lessons are open. Admissions will be in touch with your cohort schedule and what to bring on day one.'
                : 'Your application is with admissions. They review every application personally and will be in touch about next steps. Nothing has been charged — tuition is invoiced once your place is confirmed.'}
            </p>
            <dl className={styles.doneRecap}>
              <div className={styles.breakdownRow}>
                <span>Intake</span>
                <b>{batch?.batch_name ?? '—'}</b>
              </div>
              <div className={styles.breakdownRow}>
                <span>Areas of study</span>
                <b>
                  {availableAreas
                    .filter((a) => form.areas_of_interest.includes(a.slug))
                    .map((a) => a.label)
                    .join(', ') || '—'}
                </b>
              </div>
              <div className={styles.breakdownRow}>
                <span>Paid today</span>
                <b>{formatNaira(payNow)}</b>
              </div>
            </dl>
            <div className={styles.doneActions}>
              <Link className={`${styles.btn} ${styles.btnPrimary}`} href="/film-academy/dashboard">
                Go to my dashboard <span aria-hidden="true">↗</span>
              </Link>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
                Back to the academy
              </button>
            </div>
          </div>
        </section>
      )}

      {step === 'form' && (
        <form noValidate onSubmit={submit} className={`${styles.form} ${styles.stagger}`}>
          <div>
            <div className={styles.fieldHead}>
              <span className={styles.fieldLabel}>Intake <span className={styles.req}>*</span></span>
              <button type="button" className={styles.linkBtn} onClick={() => setStep('select')}>
                Change intake
              </button>
            </div>
            <select
              className={styles.control}
              required
              aria-label="Intake"
              value={form.batch_id}
              onChange={(e) => {
                // A different intake offers a different catalogue — selections
                // made against the old one must not survive the switch.
                setForm((p) => ({ ...p, batch_id: e.target.value, areas_of_interest: [] }));
                setAreaSelections({});
                setOpenAreaSlug(null);
              }}
            >
              <option value="">Choose an intake…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id} disabled={appliedBatchIds.includes(b.id)}>
                  {b.batch_name} — {formatProgrammeDate(b.start_date) ?? 'TBA'}
                  {appliedBatchIds.includes(b.id) ? ' (already applied)' : ''}
                </option>
              ))}
            </select>
            {selectedBatchApplied && (
              <p className={styles.fieldNote} style={{ color: 'var(--ok)' }}>
                You have already applied for this intake. Choose another one.
              </p>
            )}
            {batch ? (
              <p className={styles.fieldNote}>
                {scheduleLabel(batch.training_schedule)}
                {batch.duration_weeks ? ` · ${batch.duration_weeks} weeks` : ''}
                {batch.description ? ` · ${batch.description}` : ''}
              </p>
            ) : null}
          </div>

          {!signedIn && (
            <div className={styles.gate}>
              <h3>Sign in to submit</h3>
              <p>
                You can build the whole application here first. Signing in saves it to your Spotlight account so
                admissions can review it and you can follow its progress from your dashboard.
              </p>
              <div className={styles.gateActions}>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={signIn}>
                  Sign in to continue <span aria-hidden="true">↗</span>
                </button>
                <Link className={`${styles.btn} ${styles.btnGhost}`} href="/register">
                  Create an account
                </Link>
              </div>
            </div>
          )}

          {registrationFeeRequired && (
            <div className={styles.notice}>
              <span aria-hidden="true">₦</span>
              <span>
                <b>One payment of {formatNaira(payNow)}</b>
                {chargeParts.charAt(0).toUpperCase() + chargeParts.slice(1)} {applicationFeeDue > 0 ? 'are' : 'is'} taken
                together. The application is only filed once the payment is verified, and your lessons open straight
                away.
              </span>
            </div>
          )}

          <div className={styles.grid2}>
            {(applicant?.full_name || applicant?.email || applicant?.phone) && (
              <div className={`${styles.known} ${styles.span2}`}>
                <p className={styles.fieldLabel} style={{ marginBottom: 8 }}>Your details</p>
                {applicant?.full_name ? (
                  <div className={styles.knownRow}><span>Name</span><strong>{applicant.full_name}</strong></div>
                ) : null}
                {applicant?.email ? (
                  <div className={styles.knownRow}><span>Email</span><strong>{applicant.email}</strong></div>
                ) : null}
                {applicant?.phone ? (
                  <div className={styles.knownRow}><span>Phone</span><strong>{applicant.phone}</strong></div>
                ) : null}
                <p className={styles.fieldNote}>
                  Taken from your account. Update them in your profile if anything has changed.
                </p>
              </div>
            )}
            {!applicant?.full_name && (
              <div className={styles.span2}>
                <div className={styles.fieldHead}>
                  <label className={styles.fieldLabel} htmlFor="academy-full-name">Full name <span className={styles.req}>*</span></label>
                </div>
                <input
                  id="academy-full-name"
                  className={styles.control}
                  required
                  autoComplete="name"
                  placeholder="As it should appear on your certificate"
                  value={form.full_name}
                  onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
                />
              </div>
            )}
            {!applicant?.email && (
              <div>
                <div className={styles.fieldHead}>
                  <label className={styles.fieldLabel} htmlFor="academy-email">Email <span className={styles.req}>*</span></label>
                </div>
                <input
                  id="academy-email"
                  className={styles.control}
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                />
              </div>
            )}
            {!applicant?.phone && (
              <div>
                <div className={styles.fieldHead}>
                  <label className={styles.fieldLabel} htmlFor="academy-phone">Phone <span className={styles.req}>*</span></label>
                </div>
                <input
                  id="academy-phone"
                  className={styles.control}
                  type="tel"
                  required
                  autoComplete="tel"
                  placeholder="080…"
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                />
              </div>
            )}
          </div>

          <div>
            <p className={styles.label}>02 / Areas of study</p>
            <p className={styles.hint}>
              Open a training, then tap the format you want.{' '}
              {registrationFeeRequired
                ? 'Your first tuition payment is taken with the application fee when you submit.'
                : 'Nothing is charged to apply — admissions invoices tuition after review.'}
            </p>
            <p className={`${styles.hint} ${atLimit ? styles.hintStrong : ''}`}>
              {atLimit
                ? `${maxInterestAreas} of ${maxInterestAreas} chosen — deselect one to swap it.`
                : `Choose up to ${maxInterestAreas} for this intake — ${form.areas_of_interest.length} of ${maxInterestAreas} selected.`}
            </p>

            {availableAreas.length === 0 ? (
              <div className={styles.empty} style={{ marginTop: 12 }}>
                <h3>No trainings linked yet</h3>
                <p>
                  This intake has no areas of study attached to it, so there is nothing to select. Choose another
                  intake, or ask admissions what this cohort will run.
                </p>
              </div>
            ) : (
              <div className={styles.areas}>
                {availableAreas.map((area) => {
                  const active = form.areas_of_interest.includes(area.slug);
                  const hasFormats = hasStructure && (area.pricing_options?.length ?? 0) > 0;
                  const isOpen = openAreaSlug === area.slug;
                  const chosen = hasFormats
                    ? (area.pricing_options ?? []).find((o) => o.key === areaSelections[area.slug])
                    : undefined;
                  const fee = Number(area.fee_ngn ?? 0);
                  const blocked = !active && atLimit;
                  return (
                    <div
                      key={area.slug}
                      className={`${styles.area} ${active ? styles.areaOn : ''} ${isOpen ? styles.areaOpen : ''}`}
                    >
                      <button
                        type="button"
                        className={styles.areaHead}
                        onClick={() => (hasFormats ? setOpenAreaSlug(isOpen ? null : area.slug) : toggleArea(area.slug))}
                        disabled={!hasFormats && blocked}
                        aria-expanded={hasFormats ? isOpen : undefined}
                        aria-pressed={hasFormats ? undefined : active}
                      >
                        <span className={styles.tick} aria-hidden="true">✓</span>
                        <span className={styles.areaText}>
                          <span className={styles.areaName}>{area.label}</span>
                          {chosen ? (
                            <span className={styles.areaChosen}>{chosen.label} — {formatNaira(Number(chosen.price_ngn))}</span>
                          ) : !hasFormats && fee > 0 ? (
                            <span className={styles.areaChosen}>{formatNaira(fee)}</span>
                          ) : null}
                        </span>
                        {hasFormats && <Chevron />}
                      </button>

                      {hasFormats && (
                        <div className={styles.areaBody}>
                          <div className={styles.areaBodyInner} inert={!isOpen} aria-hidden={!isOpen}>
                            <div className={styles.priceLines} role="group" aria-label={`Training format for ${area.label}`}>
                              {(area.pricing_options ?? []).map((o) => {
                                const on = areaSelections[area.slug] === o.key && active;
                                const subBlocked = !on && !active && atLimit;
                                return (
                                  <button
                                    key={o.key}
                                    type="button"
                                    className={`${styles.priceLine} ${on ? styles.priceLineOn : ''}`}
                                    onClick={() => pickSub(area.slug, o.key)}
                                    disabled={subBlocked}
                                    aria-pressed={on}
                                  >
                                    <span className={styles.priceName}>
                                      {o.label}
                                      {o.note ? <small>{o.note}</small> : null}
                                    </span>
                                    <span className={styles.priceValue}>{formatNaira(Number(o.price_ngn))}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={styles.total}>
            <div className={styles.totalHead}>
              <span>Pay now</span>
              <strong className={styles.totalFigure}>{formatNaira(payNow)}</strong>
            </div>
            <p className={styles.totalNote}>
              {registrationFeeRequired ? (
                <>
                  {applicationFeeDue > 0
                    ? `Application fee ${formatNaira(applicationFeeDue)}${settings.application_fee_refundable ? '' : ' (non-refundable)'} + `
                    : ''}
                  {instalmentCount > 1 ? 'your first tuition instalment' : 'tuition'}. Lessons open as soon as you pay.
                </>
              ) : (
                'Nothing is charged to apply. Tuition is recorded against your application and invoiced by admissions.'
              )}
            </p>

            {tuitionTotal > 0 && (
              <div className={styles.breakdown}>
                <div className={`${styles.breakdownRow} ${styles.breakdownLead}`}>
                  <span>Total tuition{instalmentCount > 1 ? ` · ${instalmentCount} instalments` : ''}</span>
                  <b>{formatNaira(tuitionTotal)}</b>
                </div>
                {availableAreas
                  .filter((a) => form.areas_of_interest.includes(a.slug) && priceOf(a) > 0)
                  .map((a) => (
                    <div key={a.slug} className={`${styles.breakdownRow} ${styles.breakdownSub}`}>
                      <span>{a.label}</span>
                      <b>{formatNaira(priceOf(a))}</b>
                    </div>
                  ))}
                <p className={styles.totalNote}>
                  {registrationFeeRequired && instalmentCount > 1
                    ? 'The first instalment is paid now; the rest fall due on your plan.'
                    : registrationFeeRequired
                      ? 'The full tuition is paid now.'
                      : 'Recorded against your application — admissions invoices it after review.'}
                </p>
              </div>
            )}
          </div>

          {(deliverables.length > 0 || feeExclusions.length > 0) && (
            <div className={styles.includes}>
              {deliverables.length > 0 && (
                <>
                  <p className={styles.includesHead}>Your tuition includes</p>
                  <ul className={styles.includesList}>
                    {deliverables.map((d) => <li key={d}>{d}</li>)}
                  </ul>
                </>
              )}
              {feeExclusions.length > 0 && (
                <>
                  <p className={`${styles.includesHead} ${styles.includesHeadMuted}`}>Fees exclude</p>
                  <ul className={`${styles.includesList} ${styles.includesListMuted}`}>
                    {feeExclusions.map((d) => <li key={d}>{d}</li>)}
                  </ul>
                </>
              )}
            </div>
          )}

          <div>
            <div className={styles.fieldHead}>
              <label className={styles.fieldLabel} htmlFor="academy-motivation">Why do you want to join? <span className={styles.req}>*</span></label>
            </div>
            <textarea
              id="academy-motivation"
              className={styles.control}
              required
              placeholder="The story you want to tell, and the craft you want to learn to tell it with."
              value={form.motivation}
              onChange={(e) => setForm((p) => ({ ...p, motivation: e.target.value }))}
            />
          </div>

          <div>
            <div className={styles.fieldHead}>
              <label className={styles.fieldLabel} htmlFor="academy-experience">Relevant experience <span style={{ color: 'var(--dim)' }}>(optional)</span></label>
            </div>
            <textarea
              id="academy-experience"
              className={styles.control}
              style={{ minHeight: 74 }}
              placeholder="Sets you have worked on, films you have made, links to your work."
              value={form.experience}
              onChange={(e) => setForm((p) => ({ ...p, experience: e.target.value }))}
            />
          </div>

          <div>
            <div className={styles.fieldHead}>
              <span className={styles.fieldLabel}>How would you like to pay tuition?</span>
            </div>
            <div className={styles.chips} role="group" aria-label="Tuition payment preference">
              {(['installment', 'one_off'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`${styles.chip} ${form.payment_preference === p ? styles.chipOn : ''}`}
                  aria-pressed={form.payment_preference === p}
                  onClick={() => setForm((prev) => ({ ...prev, payment_preference: p }))}
                >
                  {p === 'installment' ? 'In instalments' : 'One-off'}
                </button>
              ))}
            </div>
            <p className={styles.fieldNote}>
              {!registrationFeeRequired
                ? 'Recorded for when admissions invoices your tuition. Nothing is charged for this choice today.'
                : form.payment_preference === 'one_off'
                  ? discountPct > 0
                    ? `${discountPct}% off tuition for paying in full — today's charge already reflects it.`
                    : 'The whole tuition is charged today, in one payment.'
                  : instalmentCount > 1
                    ? `Tuition is spread over ${instalmentCount} payments. Only the first is charged today.`
                    : 'This intake bills tuition in full, so the whole amount falls due today.'}
            </p>
          </div>

          {error && (
            <div className={styles.error} role="alert" ref={errorRef}>
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}

          <div className={styles.actions}>
            <div className={styles.actionsMeta}>
              <span>{registrationFeeRequired ? 'Charged once, securely' : 'No payment is taken to apply'}</span>
              <b>{formatNaira(payNow)}</b>
            </div>
            <button
              type="submit"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`}
              disabled={submitDisabled}
            >
              {submitting && <span className={styles.spinner} aria-hidden="true" />}
              {selectedBatchApplied
                ? 'Already applied'
                : submitting
                  ? registrationFeeRequired ? 'Opening payment…' : 'Submitting…'
                  : !signedIn
                    ? 'Sign in to apply'
                    : registrationFeeRequired
                      ? `Pay ${formatNaira(payNow)} & apply`
                      : 'Submit application'}
              {!submitting && !selectedBatchApplied && <span aria-hidden="true">↗</span>}
            </button>
            <span className={styles.secure}>
              <LockIcon />
              {registrationFeeRequired ? 'Card payment secured by Paystack' : 'Reviewed by the admissions team'}
            </span>
          </div>
        </form>
      )}
    </div>
  );
}