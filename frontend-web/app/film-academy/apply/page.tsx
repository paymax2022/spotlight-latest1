'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authHeaders } from '@/src/lib/auth/client';
import { createClient } from '@/src/lib/supabase/client';
import { loadPaystackClient } from '@/src/lib/payments/paystack-client';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(n);

type Batch = {
  id: string; batch_name: string; start_date: string; status: string;
  training_schedule: string; duration_weeks: number; description: string;
  training_fee_ngn: number; one_off_discount_pct: number;
  installments_count: number; fee_frequency: string;
};
/**
 * The applicant's details as the ACCOUNT already holds them, returned by
 * GET /api/academy/apply. Name, email and phone are shown read-only — the user
 * gave them at sign-up and must not be asked again; the rest just pre-fill.
 * An empty string means the profile genuinely has no value, so the form still
 * asks for it (and the server saves the answer back to the profile).
 */
type Applicant = {
  full_name: string; email: string; phone: string;
  gender: string; date_of_birth: string; state: string; city: string; country: string;
};

type AcademySettings = {
  registration_type: 'free' | 'paid';
  application_fee: number;
  application_fee_refundable: boolean;
  tuition_fee: number;
};

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

const AREAS = ['film_directing','cinematography','script_writing','video_editing','sound_design','production_management','acting'];
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
    tuition_fee: 0,
  });
  const [loading, setLoading]   = useState(true);
  const [step, setStep]         = useState<'select' | 'form' | 'payment' | 'done'>(prefillBatch ? 'form' : 'select');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [applicant, setApplicant] = useState<Applicant | null>(null);

  const [form, setForm] = useState({
    batch_id: prefillBatch,
    full_name: '', email: '', phone: '',
    gender: '', date_of_birth: '', state: '', country: 'Nigeria',
    areas_of_interest: [] as string[],
    motivation: '', experience: '', portfolio_url: '',
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

        if (json.applicant) {
          const known = json.applicant as Applicant;
          setApplicant(known);
          // Fill from the account, but never clobber anything already typed —
          // this resolves after the form is interactive.
          setForm((p) => ({
            ...p,
            full_name:     p.full_name     || known.full_name || '',
            email:         p.email         || known.email || '',
            phone:         p.phone         || known.phone || '',
            gender:        p.gender        || known.gender || '',
            date_of_birth: p.date_of_birth || known.date_of_birth || '',
            state:         p.state         || known.state || '',
            country:       known.country   || p.country,
          }));
        }
        if (json.settings) {
          setSettings({
            registration_type: json.settings.registration_type === 'paid' ? 'paid' : 'free',
            application_fee: Number(json.settings.application_fee ?? 0),
            application_fee_refundable: json.settings.application_fee_refundable === true,
            tuition_fee: Number(json.settings.tuition_fee ?? 0),
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
  const hasFee = batch && batch.training_fee_ngn > 0;
  const oneOffAmount = hasFee ? Math.round(batch.training_fee_ngn * (1 - (batch.one_off_discount_pct ?? 0) / 100)) : 0;
  const installmentAmount = hasFee ? Math.round(batch.training_fee_ngn / (batch.installments_count || 1)) : 0;
  const submitDisabled = submitting || selectedBatchApplied;

  function toggleArea(area: string) {
    setForm((p) => ({
      ...p,
      areas_of_interest: p.areas_of_interest.includes(area)
        ? p.areas_of_interest.filter((a) => a !== area)
        : [...p.areas_of_interest, area],
    }));
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
    if (!form.state.trim()) return 'State is required.';
    if (form.areas_of_interest.length === 0) return 'Select at least one area of interest.';
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
        router.push(`/login?next=${encodeURIComponent(pathname || '/apply/film-academy')}`);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Submission failed');

      setApplicationId(json.applicationId ?? '');
      setAppliedBatchIds((current) => Array.from(new Set([...current, form.batch_id])));

      // If one-off payment, open Paystack immediately
      if (form.payment_preference === 'one_off' && hasFee) {
        setStep('payment');
      } else {
        setStep('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
      setSubmitting(false);
    }
  }

  async function payRegistrationFeeAndSubmit() {
    const headers = await authHeaders();
    if (!headers.Authorization) {
      router.push(`/login?next=${encodeURIComponent(pathname || '/apply/film-academy')}`);
      return;
    }

    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';
    if (!publicKey || publicKey.includes('placeholder')) {
      setError('Payment gateway not configured. Contact support.');
      setSubmitting(false);
      return;
    }

    try {
      const PaystackPop = await loadPaystackClient();
      const handler = new PaystackPop();
      handler.newTransaction({
        key: publicKey,
        email: form.email,
        amount: Math.round(settings.application_fee * 100),
        currency: 'NGN',
        metadata: {
          custom_fields: [
            { display_name: 'Payment Type', variable_name: 'payment_type', value: 'Film Academy Registration Fee' },
            { display_name: 'Batch', variable_name: 'batch_name', value: batch?.batch_name ?? '' },
          ],
        },
        onSuccess: (transaction) => {
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
      await payRegistrationFeeAndSubmit();
      return;
    }

    await submitApplication();
  }

  async function payNow() {
    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';
    if (!publicKey || publicKey.includes('placeholder')) {
      setError('Payment gateway not configured. Contact support.');
      return;
    }
    try {
      const PaystackPop = await loadPaystackClient();
      const handler = new PaystackPop();
      handler.newTransaction({
        key: publicKey,
        email: form.email,
        amount: oneOffAmount * 100,
        currency: 'NGN',
        metadata: { custom_fields: [
          { display_name: 'Application ID', variable_name: 'application_id', value: applicationId },
          { display_name: 'Batch', variable_name: 'batch_name', value: batch?.batch_name ?? '' },
        ]},
        onSuccess: () => setStep('done'),
        onCancel:  () => setStep('done'), // still submitted — they can pay later from dashboard
        onError:   (e) => setError(e.message),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
    }
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
                  const tuition = Number(b.training_fee_ngn || 0);
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

                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <div>
                          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 2 }}>Tuition</p>
                          <p style={{ color: '#fff', fontWeight: 900, marginBottom: 0 }}>
                            {tuition > 0 ? fmt(tuition) : 'Free tuition'}
                          </p>
                          {tuition > 0 && b.installments_count > 1 && (
                            <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: 12, marginTop: 2, marginBottom: 0 }}>
                              {b.installments_count} {b.fee_frequency} installments available
                            </p>
                          )}
                        </div>
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
              Your application has been received. You will be notified once reviewed.{' '}
              {form.payment_preference === 'installment' && 'Your installment schedule will be set up when your application is approved.'}
            </p>
            <Link href="/film-academy/dashboard" style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontWeight: 700, padding: '12px 28px', borderRadius: 10, textDecoration: 'none' }}>
              Go to My Dashboard
            </Link>
          </div>
        )}

        {/* ── Payment prompt (one-off) ──────────────────────────── */}
        {step === 'payment' && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '32px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 14 }}>💳</div>
            <h2 style={{ color: '#fff', fontWeight: 800, marginBottom: 8 }}>Complete Your Payment</h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>
              You chose to pay the full tuition fee at once{batch?.one_off_discount_pct ? ` and save ${batch.one_off_discount_pct}%` : ''}.
            </p>
            <p style={{ color: '#f59e0b', fontSize: 28, fontWeight: 900, marginBottom: 24 }}>{fmt(oneOffAmount)}</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={payNow} style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontWeight: 800, fontSize: 15, padding: '12px 32px', borderRadius: 10, border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(245,158,11,0.35)' }}>
                Pay Now
              </button>
              <button onClick={() => setStep('done')} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)', padding: '12px 20px', borderRadius: 10, cursor: 'pointer', fontSize: 13 }}>
                Pay Later from Dashboard
              </button>
            </div>
            {error && <p style={{ color: '#ef4444', marginTop: 14, fontSize: 13 }}>{error}</p>}
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
              <select style={inp} required value={form.batch_id} onChange={(e) => setForm((p) => ({ ...p, batch_id: e.target.value }))}>
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
              <div>
                <label style={lbl}>Gender</label>
                <select style={inp} value={form.gender} onChange={(e) => setForm((p) => ({ ...p, gender: e.target.value }))}>
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Date of Birth</label>
                <input style={inp} type="date" value={form.date_of_birth} onChange={(e) => setForm((p) => ({ ...p, date_of_birth: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>State *</label>
                <input style={inp} required value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} placeholder="e.g. Lagos" />
              </div>
            </div>

            {/* Areas of interest */}
            <div>
              <label style={lbl}>Areas of Interest *</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {AREAS.map((area) => {
                  const active = form.areas_of_interest.includes(area);
                  return (
                    <button key={area} type="button" onClick={() => toggleArea(area)}
                      style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                        background: active ? '#f59e0b' : 'rgba(255,255,255,0.07)',
                        color: active ? '#000' : 'rgba(255,255,255,0.5)' }}>
                      {area.replace(/_/g, ' ')}
                    </button>
                  );
                })}
              </div>
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
            <div>
              <label style={lbl}>Portfolio / Showreel URL (optional)</label>
              <input style={inp} type="url" value={form.portfolio_url}
                onChange={(e) => setForm((p) => ({ ...p, portfolio_url: e.target.value }))} placeholder="https://…" />
            </div>

            {/* ── Payment preference ─────────────────────────────── */}
            {hasFee && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 20 }}>
                <p style={{ color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Tuition Fee Payment Preference</p>
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 16 }}>
                  Choose how you&apos;d like to pay the{' '}
                  <strong style={{ color: '#f59e0b' }}>{fmt(batch.training_fee_ngn)}</strong> tuition fee.
                </p>

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {/* One-off option */}
                  <button type="button" onClick={() => setForm((p) => ({ ...p, payment_preference: 'one_off' }))}
                    style={{ flex: '1 1 220px', padding: '16px 20px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                      border: `2px solid ${form.payment_preference === 'one_off' ? '#f59e0b' : 'rgba(255,255,255,0.1)'}`,
                      background: form.payment_preference === 'one_off' ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <span style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>💳 Pay in Full</span>
                      {batch.one_off_discount_pct > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(16,185,129,0.2)', color: '#10b981' }}>
                          Save {batch.one_off_discount_pct}%
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 20, fontWeight: 900, color: '#f59e0b', marginBottom: 2 }}>{fmt(oneOffAmount)}</p>
                    {batch.one_off_discount_pct > 0 && (
                      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 0 }}>
                        <span style={{ textDecoration: 'line-through' }}>{fmt(batch.training_fee_ngn)}</span>{' '}one-time payment
                      </p>
                    )}
                    {!batch.one_off_discount_pct && (
                      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 0 }}>Single payment, cleared immediately</p>
                    )}
                  </button>

                  {/* Installment option */}
                  <button type="button" onClick={() => setForm((p) => ({ ...p, payment_preference: 'installment' }))}
                    style={{ flex: '1 1 220px', padding: '16px 20px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                      border: `2px solid ${form.payment_preference === 'installment' ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
                      background: form.payment_preference === 'installment' ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.03)' }}>
                    <span style={{ fontWeight: 800, fontSize: 14, color: '#fff', display: 'block', marginBottom: 6 }}>📅 Pay in Installments</span>
                    <p style={{ fontSize: 20, fontWeight: 900, color: '#a5b4fc', marginBottom: 2 }}>{fmt(installmentAmount)} × {batch.installments_count}</p>
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 0 }}>
                      {batch.installments_count} {batch.fee_frequency} payments · Total: {fmt(batch.training_fee_ngn)}
                    </p>
                  </button>
                </div>
              </div>
            )}

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
                    : form.payment_preference === 'one_off'
                      ? 'Submit & Proceed to Payment'
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
