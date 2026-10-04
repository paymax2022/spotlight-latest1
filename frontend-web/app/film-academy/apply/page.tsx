'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authHeaders } from '@/src/lib/auth/client';
import { createClient } from '@/src/lib/supabase/client';
import { loadPaystackClient } from '@/src/lib/payments';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(n);

type Batch = {
  id: string; batch_name: string; start_date: string; status: string;
  training_schedule: string; duration_weeks: number; description: string;
};
/**
 * The applicant's details as the ACCOUNT already holds them, returned by
 * GET /api/academy/apply. Name, email and phone are shown read-only — the user
 * gave them at sign-up and must not be asked again; the rest just pre-fill.
 * An empty string means the profile genuinely has no value, so the form still
 * asks for it (and the server saves the answer back to the profile).
 */
type Applicant = { full_name: string; email: string; phone: string };

type AcademySettings = {
  registration_type: 'free' | 'paid';
  application_fee: number;
  application_fee_refundable: boolean;
};

/**
 * Admin-managed area of interest, carrying its own NAIRA tuition fee — the SAME
 * shape the mobile app consumes from this endpoint. This is the single source of
 * truth for both clients; nothing here is hardcoded, because inventing a
 * client-side list is exactly how a client ends up offering an area the
 * database does not have (or missing one it does).
 */
type InterestArea = { slug: string; label: string; description: string | null; fee_ngn: number };

const inp: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 10, boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#f1f5f9', fontSize: 14, outline: 'none',
};
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
  textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 5,
};

const knownBox: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 10, padding: '12px 14px',
};

function KnownRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0' }}>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#f1f5f9', textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

const SCHEDULES: Record<string, string> = { weekdays: 'Mon–Fri', weekends: 'Sat–Sun', accelerated: 'Intensive' };

export default function AcademyApplyPage({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prefillBatch = searchParams?.get('batch') ?? '';

  const [batches, setBatches]   = useState<Batch[]>([]);
  const [appliedBatchIds, setAppliedBatchIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<AcademySettings>({
    registration_type: 'free',
    application_fee: 0,
    application_fee_refundable: false,
  });
  // Same catalogue + rules the mobile app reads from this endpoint — see
  // src/features/filmAcademy/api.ts getOverview(). Fees and the per-application
  // cap are admin-managed and server-enforced; the client only mirrors them.
  const [interestAreas, setInterestAreas] = useState<InterestArea[]>([]);
  const [batchAreas, setBatchAreas]       = useState<Record<string, string[]>>({});
  const [maxInterestAreas, setMaxInterestAreas] = useState(2);
  const [loading, setLoading]   = useState(true);
  const [step, setStep]         = useState<'select' | 'form' | 'done'>(prefillBatch ? 'form' : 'select');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState('');
  const [applicant, setApplicant] = useState<Applicant | null>(null);
  // A reference whose charge already succeeded but whose submit failed — kept
  // so a resubmit reuses the paid charge instead of opening a fresh one.
  const [paidFeeReference, setPaidFeeReference] = useState('');

  const [form, setForm] = useState({
    batch_id: prefillBatch,
    full_name: '', email: '', phone: '',
    areas_of_interest: [] as string[],
    motivation: '', experience: '',
    payment_preference: 'installment' as 'one_off' | 'installment',
  });

  useEffect(() => {
    let cancelled = false;

    async function loadBatches() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace(`/login?next=${encodeURIComponent(pathname || '/film-academy/apply')}`);
        return;
      }

      try {
        const res = await fetch('/api/academy/apply', { headers: await authHeaders() });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;

        const appliedIds = Array.isArray(json.appliedBatchIds) ? json.appliedBatchIds : [];
        setBatches(json.batches ?? []);
        setAppliedBatchIds(appliedIds);
        // Empty rather than a hardcoded fallback list — see the InterestArea
        // type comment; the mobile client applies the same rule.
        setInterestAreas(Array.isArray(json.interestAreas) ? json.interestAreas : []);
        setBatchAreas(json.batchAreas && typeof json.batchAreas === 'object' ? json.batchAreas : {});
        // Fall back to 2 only if an older server omits it — the server still enforces.
        setMaxInterestAreas(Number.isFinite(json.maxInterestAreas) ? json.maxInterestAreas : 2);

        if (json.applicant) {
          const known = json.applicant as Applicant;
          setApplicant(known);
          // Fill from the account, but never clobber anything already typed —
          // this resolves after the form is interactive.
          setForm((p) => ({
            ...p,
            full_name: p.full_name || known.full_name || '',
            email:     p.email     || known.email || '',
            phone:     p.phone     || known.phone || '',
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
          setError('You have already applied for this Film Academy batch.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadBatches();

    return () => {
      cancelled = true;
    };
  }, []);

  const batch = batches.find((b) => b.id === form.batch_id);
  const selectedBatchApplied = Boolean(form.batch_id && appliedBatchIds.includes(form.batch_id));
  const registrationFeeRequired = settings.registration_type === 'paid' && settings.application_fee > 0;
  const submitDisabled = submitting || selectedBatchApplied;

  // Only the areas THIS batch offers. An empty/missing entry means the batch is
  // unrestricted, so it falls back to the full active list rather than showing
  // nothing — matches the mobile app exactly (see FilmAcademyApplyScreen).
  const offeredSlugs = (form.batch_id && batchAreas[form.batch_id]) || [];
  const availableAreas = offeredSlugs.length > 0
    ? interestAreas.filter((a) => offeredSlugs.includes(a.slug))
    : interestAreas;
  const atLimit = form.areas_of_interest.length >= maxInterestAreas;

  // TUITION for the chosen areas — payable on ACCEPTANCE and refundable. Shown so
  // this same total from the same admin-managed rows when the application is
  // submitted, so this is a display convenience and cannot be used to pay less.
  const tuitionTotal = availableAreas
    .filter((a) => form.areas_of_interest.includes(a.slug))
    .reduce((sum, a) => sum + Number(a.fee_ngn ?? 0), 0);

  function toggleArea(slug: string) {
    setForm((p) => {
      const on = p.areas_of_interest.includes(slug);
      if (on) return { ...p, areas_of_interest: p.areas_of_interest.filter((a) => a !== slug) };
      // Silently ignoring the tap would look like a broken chip, so callers
      // disable it instead — see `atLimit` below.
      if (p.areas_of_interest.length >= maxInterestAreas) return p;
      return { ...p, areas_of_interest: [...p.areas_of_interest, slug] };
    });
  }

  function selectBatch(batchId: string) {
    if (appliedBatchIds.includes(batchId)) {
      setError('You have already applied for this Film Academy batch.');
      return;
    }

    setError('');
    setForm((p) => ({ ...p, batch_id: batchId }));
    setStep('form');
  }

  function validateForm() {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!form.batch_id) return 'Please select an intake batch.';
    if (selectedBatchApplied) return 'You have already applied for this batch. Please choose another batch.';
    if (!form.full_name.trim()) return 'Full name is required.';
    if (!form.email.trim() || !emailPattern.test(form.email.trim())) return 'A valid email address is required.';
    if (!form.phone.trim()) return 'Phone number is required.';
    if (form.areas_of_interest.length === 0) return 'Choose at least one area of interest.';
    if (form.areas_of_interest.length > maxInterestAreas) {
      return `Choose at most ${maxInterestAreas} areas of interest for this batch.`;
    }
    if (!form.motivation.trim()) return 'Tell us why you want to join.';

    return '';
  }

  async function submitApplication(applicationFeeReference?: string) {
    try {
      const res = await fetch('/api/academy/apply', {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({
          ...form,
          application_fee_reference: applicationFeeReference,
        }),
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(pathname || '/film-academy/apply')}`);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Submission failed');

      setAppliedBatchIds((current) => Array.from(new Set([...current, form.batch_id])));
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
      setSubmitting(false);
    }
  }

  async function payRegistrationFeeAndSubmit() {
    const headers = await authHeaders();
    if (!headers.Authorization) {
      router.push(`/login?next=${encodeURIComponent(pathname || '/film-academy/apply')}`);
      return;
    }

    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';
    if (!publicKey || publicKey.includes('placeholder')) {
      setError('Payment gateway not configured. Contact support.');
      setSubmitting(false);
      return;
    }

    try {
      // Mint the reference SERVER-SIDE first: the initiate endpoint writes a
      // pending intent keyed by it, freezing the application-fee quote and
      // giving the webhook/reconcile sweep a record to fulfil if this browser
      // never submits the form (AUD-FE-003 residual). Passing our reference to
      // Paystack is what makes the charge discoverable — a Paystack-minted
      // reference would orphan the payment again.
      const initRes = await fetch('/api/academy/application-fee/initiate', {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({
          email: form.email,
          full_name: form.full_name,
          batch_id: form.batch_id,
        }),
      });
      const initJson = await initRes.json().catch(() => ({}));
      if (!initRes.ok) {
        throw new Error(initJson?.error || 'Could not start the registration fee payment.');
      }
      const feeReference = String(initJson.reference ?? '');
      const amountKobo = Number(initJson.amountKobo ?? 0);
      if (!feeReference || !(amountKobo > 0)) {
        throw new Error('Could not start the registration fee payment.');
      }

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
          setError('Registration fee payment is required before submitting this application.');
          setSubmitting(false);
        },
        onError: (paymentError) => {
          setError(paymentError.message || 'Registration fee payment failed.');
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

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    if (registrationFeeRequired) {
      // A paid-but-unsubmitted charge is reused, never re-taken: the same
      // reference files the retry (the intent is still 'paid' for it).
      if (paidFeeReference) {
        await submitApplication(paidFeeReference);
        return;
      }
      await payRegistrationFeeAndSubmit();
      return;
    }

    await submitApplication();
  }

  if (loading) return (
    <div style={{ minHeight: embedded ? 220 : '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: embedded ? '#0d0d1a' : 'linear-gradient(160deg,#0d0d1a 0%,#14102b 100%)', borderRadius: embedded ? 16 : 0 }}>
      <p style={{ color: 'rgba(255,255,255,0.5)' }}>Loading…</p>
    </div>
  );

  const content = (
    <div style={{ maxWidth: embedded ? '100%' : 680, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 11, color: 'rgba(245,158,11,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>🎬 Spotlight Film Academy</p>
          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(1.6rem,4vw,2.2rem)', marginBottom: 4 }}>Apply for Admission</h1>
          <p style={{ color: 'rgba(255,255,255,0.5)' }}>
            Choose an academy training batch, then complete your registration.
          </p>
        </div>

        {/* ── Batch selection ───────────────────────────────────── */}
        {step === 'select' && (
          <section>
            {batches.length === 0 ? (
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '32px', textAlign: 'center' }}>
                <h2 style={{ color: '#fff', fontWeight: 800, marginBottom: 8 }}>No Open Batches</h2>
                <p style={{ color: 'rgba(255,255,255,0.55)', marginBottom: 0 }}>
                  There are no Film Academy training batches accepting applications right now.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                {batches.map((b) => {
                  const starts = b.start_date
                    ? new Date(b.start_date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
                    : 'Date TBA';
                  const alreadyApplied = appliedBatchIds.includes(b.id);

                  return (
                    <article
                      key={b.id}
                      style={{
                        background: alreadyApplied ? 'rgba(16,185,129,0.09)' : 'rgba(255,255,255,0.045)',
                        border: `1px solid ${alreadyApplied ? 'rgba(16,185,129,0.45)' : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: 16,
                        padding: 22,
                        boxShadow: alreadyApplied ? '0 18px 50px rgba(16,185,129,0.12)' : '0 18px 50px rgba(0,0,0,0.18)',
                        opacity: alreadyApplied ? 0.82 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 260px' }}>
                          <p style={{ color: '#f59e0b', fontSize: 11, fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 8 }}>
                            {SCHEDULES[b.training_schedule] ?? b.training_schedule} · {b.duration_weeks} weeks
                          </p>
                          <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 900, marginBottom: 8 }}>{b.batch_name}</h2>
                          <p style={{ color: 'rgba(255,255,255,0.55)', marginBottom: 0 }}>{b.description || 'Practical film training, production exposure, and academy mentorship.'}</p>
                        </div>
                        <div style={{ textAlign: 'right', minWidth: 150 }}>
                          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 4 }}>Starts</p>
                          <p style={{ color: '#fff', fontWeight: 800, marginBottom: 10 }}>{starts}</p>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <span style={{
                              display: 'inline-block',
                              borderRadius: 999,
                              padding: '4px 10px',
                              background: b.status === 'ongoing' ? 'rgba(16,185,129,0.14)' : 'rgba(99,102,241,0.14)',
                              color: b.status === 'ongoing' ? '#34d399' : '#a5b4fc',
                              fontSize: 11,
                              fontWeight: 800,
                              textTransform: 'uppercase',
                            }}>
                              {b.status}
                            </span>
                            {alreadyApplied && (
                              <span style={{
                                display: 'inline-block',
                                borderRadius: 999,
                                padding: '4px 10px',
                                background: 'rgba(16,185,129,0.2)',
                                color: '#34d399',
                                fontSize: 11,
                                fontWeight: 900,
                                textTransform: 'uppercase',
                              }}>
                                Applied
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <button
                          type="button"
                          disabled={alreadyApplied}
                          onClick={() => selectBatch(b.id)}
                          style={{
                            background: alreadyApplied ? '#6b7280' : 'linear-gradient(135deg,#f59e0b,#d97706)',
                            color: alreadyApplied ? 'rgba(255,255,255,0.72)' : '#000',
                            fontWeight: 900,
                            padding: '12px 24px',
                            borderRadius: 10,
                            border: 'none',
                            cursor: alreadyApplied ? 'not-allowed' : 'pointer',
                            pointerEvents: alreadyApplied ? 'none' : 'auto',
                            boxShadow: alreadyApplied ? 'none' : '0 4px 20px rgba(245,158,11,0.28)',
                          }}
                        >
                          {alreadyApplied ? 'Already Applied' : 'Apply for this Batch'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Done ──────────────────────────────────────────────── */}
        {step === 'done' && (
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 16, padding: '40px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🎉</div>
            <h2 style={{ color: '#fff', fontWeight: 800, marginBottom: 8 }}>Application Submitted!</h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 24 }}>
              Your application has been received. We will be in touch about next steps. Tuition for your chosen
              areas is payable only if you are offered a place.
            </p>
            <Link href="/film-academy/dashboard" style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontWeight: 700, padding: '12px 28px', borderRadius: 10, textDecoration: 'none' }}>
              Go to My Dashboard
            </Link>
          </div>
        )}

        {/* ── Application Form ──────────────────────────────────── */}
        {step === 'form' && (
          <form noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

            {/* Batch selection */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 6 }}>
                <label style={{ ...lbl, marginBottom: 0 }}>Selected Intake Batch *</label>
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  style={{ background: 'transparent', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}
                >
                  Change batch
                </button>
              </div>
              <select style={inp} required value={form.batch_id} onChange={(e) => setForm((p) => ({ ...p, batch_id: e.target.value, areas_of_interest: [] }))}>
                <option value="">Select a batch…</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id} disabled={appliedBatchIds.includes(b.id)}>
                    {b.batch_name} — {b.start_date ? new Date(b.start_date).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' }) : 'TBA'} ({SCHEDULES[b.training_schedule] ?? b.training_schedule}){appliedBatchIds.includes(b.id) ? ' — already applied' : ''}
                  </option>
                ))}
              </select>
              {selectedBatchApplied && (
                <p style={{ marginTop: 6, fontSize: 12, color: '#34d399', fontWeight: 700 }}>
                  You have already applied for this batch. Please choose another batch.
                </p>
              )}
              {batch?.description && <p style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{batch.description}</p>}
            </div>

            {registrationFeeRequired && (
              <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ color: '#f59e0b', fontWeight: 800, fontSize: 14, marginBottom: 4 }}>
                  Registration Fee Required: {fmt(settings.application_fee)}
                </p>
                <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginBottom: 0 }}>
                  Your application will only be submitted after this fee is paid and verified.
                  {settings.application_fee_refundable ? ' This fee is marked as refundable.' : ''}
                </p>
              </div>
            )}

            {/* Personal details. Anything the account already holds is shown
                read-only — the user gave it at sign-up, so this form does not
                ask for it again. Only a genuinely missing field gets an input,
                and the server saves that answer to the profile. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {(applicant?.full_name || applicant?.email || applicant?.phone) && (
                <div style={{ gridColumn: '1/-1', ...knownBox }}>
                  <div style={{ ...lbl, marginBottom: 8 }}>Your details</div>
                  {!!applicant?.full_name && <KnownRow label="Name" value={applicant.full_name} />}
                  {!!applicant?.email     && <KnownRow label="Email" value={applicant.email} />}
                  {!!applicant?.phone     && <KnownRow label="Phone" value={applicant.phone} />}
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', margin: '8px 0 0' }}>
                    Taken from your account. Update them in your profile if anything has changed.
                  </p>
                </div>
              )}
              {!applicant?.full_name && (
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={lbl}>Full Name *</label>
                  <input style={inp} required value={form.full_name} onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))} />
                </div>
              )}
              {!applicant?.email && (
                <div>
                  <label style={lbl}>Email Address *</label>
                  <input style={inp} type="email" required value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
                </div>
              )}
              {!applicant?.phone && (
                <div>
                  <label style={lbl}>Phone *</label>
                  <input style={inp} type="tel" required value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
              )}
            </div>

            {/* Areas of interest — admin-managed catalogue, per-batch offered
                subset, server-enforced cap. Same data and same rules the mobile
                app renders from this same endpoint. */}
            <div>
              <label style={lbl}>Areas of Interest *</label>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: -2, marginBottom: 8 }}>
                Amounts shown are tuition, payable only if you are offered a place.
              </p>
              <p style={{ fontSize: 12, color: atLimit ? '#f59e0b' : 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
                {atLimit
                  ? `You have chosen ${maxInterestAreas} of ${maxInterestAreas}. Deselect one to swap it.`
                  : `Choose up to ${maxInterestAreas} for this batch — ${form.areas_of_interest.length} of ${maxInterestAreas} selected.`}
              </p>
              {availableAreas.length === 0 ? (
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
                  No areas are available to choose right now. Please try again later.
                </p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {availableAreas.map((area) => {
                    const active = form.areas_of_interest.includes(area.slug);
                    const fee = Number(area.fee_ngn ?? 0);
                    const blocked = !active && atLimit;
                    return (
                      <button
                        key={area.slug}
                        type="button"
                        onClick={() => toggleArea(area.slug)}
                        disabled={blocked}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                          padding: '8px 14px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                          cursor: blocked ? 'not-allowed' : 'pointer', border: 'none', transition: 'all 0.15s',
                          opacity: blocked ? 0.4 : 1,
                          background: active ? '#f59e0b' : 'rgba(255,255,255,0.07)',
                          color: active ? '#000' : 'rgba(255,255,255,0.7)',
                        }}
                      >
                        <span>{area.label}</span>
                        <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.75 }}>
                          {fee > 0 ? fmt(fee) : 'No tuition'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Running total — mirrors the mobile app's totalBox exactly: what is
                charged NOW (application fee, non-refundable) vs. tuition owed
                only on acceptance. */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Pay now</span>
                <span style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>{fmt(settings.application_fee)}</span>
              </div>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 4, marginBottom: 0 }}>
                Application fee. Non-refundable, and charged whether or not you are offered a place.
              </p>

              {tuitionTotal > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Tuition if accepted</span>
                    <span style={{ fontSize: 14, color: '#f1f5f9', fontWeight: 700 }}>{fmt(tuitionTotal)}</span>
                  </div>
                  {availableAreas
                    .filter((a) => form.areas_of_interest.includes(a.slug) && Number(a.fee_ngn ?? 0) > 0)
                    .map((a) => (
                      <div key={a.slug} style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 10, marginTop: 4 }}>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{a.label}</span>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{fmt(Number(a.fee_ngn))}</span>
                      </div>
                    ))}
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 8, marginBottom: 0 }}>
                    Payable only if you are offered a place, and refundable. Nothing for tuition is taken today.
                  </p>
                </>
              )}
            </div>

            {/* Motivation */}
            <div>
              <label style={lbl}>Why do you want to join? *</label>
              <textarea style={{ ...inp, minHeight: 90, resize: 'vertical' }} required value={form.motivation}
                onChange={(e) => setForm((p) => ({ ...p, motivation: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Relevant Experience (optional)</label>
              <textarea style={{ ...inp, minHeight: 70, resize: 'vertical' }} value={form.experience}
                onChange={(e) => setForm((p) => ({ ...p, experience: e.target.value }))} />
            </div>

            {/* How would you like to pay tuition — informational preference only.
                Recorded on the application for when tuition is invoiced on
                acceptance; nothing is charged for this choice today. Matches the
                mobile app's chip pair exactly (no discount math tied to it —
                that lived only in this page and was never backed by the
                server). */}
            <div>
              <label style={lbl}>How would you like to pay?</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {(['installment', 'one_off'] as const).map((p) => {
                  const active = form.payment_preference === p;
                  return (
                    <button key={p} type="button" onClick={() => setForm((prev) => ({ ...prev, payment_preference: p }))}
                      style={{ padding: '8px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                        background: active ? '#f59e0b' : 'rgba(255,255,255,0.07)',
                        color: active ? '#000' : 'rgba(255,255,255,0.6)' }}>
                      {p === 'installment' ? 'In instalments' : 'One-off'}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '10px 16px', color: '#fca5a5', fontSize: 13 }}>
                ⚠ {error}
              </div>
            )}

            <button type="submit" disabled={submitDisabled}
              style={{ padding: '14px', borderRadius: 12, border: 'none', fontWeight: 800, fontSize: 15, cursor: submitDisabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                background: submitDisabled ? '#6b7280' : 'linear-gradient(135deg,#f59e0b,#d97706)',
                color: submitDisabled ? 'rgba(255,255,255,0.72)' : '#000',
                boxShadow: submitDisabled ? 'none' : '0 4px 20px rgba(245,158,11,0.35)' }}>
              {selectedBatchApplied
                ? 'Already Applied'
                : submitting
                  ? registrationFeeRequired ? 'Opening Payment...' : 'Submitting...'
                  : registrationFeeRequired
                    ? `Pay Registration Fee (${fmt(settings.application_fee)})`
                    : 'Submit Application'}
            </button>
          </form>
        )}
    </div>
  );

  if (embedded) {
    return (
      <section style={{ background: 'linear-gradient(160deg,#0d0d1a 0%,#14102b 60%,#0d0d1a 100%)', padding: 24, borderRadius: 16 }}>
        {content}
      </section>
    );
  }

  return (
    <main style={{ minHeight: '80vh', background: 'linear-gradient(160deg,#0d0d1a 0%,#14102b 60%,#0d0d1a 100%)', padding: '40px 16px' }}>
      {content}
    </main>
  );
}
