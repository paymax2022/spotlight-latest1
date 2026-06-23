'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/layout/Layout';
import { authHeaders } from '@/src/lib/auth/client';
import { loadPaystackClient } from '@/src/lib/payments/paystack-client';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(n);

type Payment = {
  id: string; installment_number: number; amount_ngn: number;
  due_date: string; status: string; paid_at?: string; reminder_count: number;
};
type Plan = {
  id: string; total_amount_ngn: number; installments_count: number;
  frequency: string; status: string;
  academy_installment_payments: Payment[];
  academy_applications: {
    full_name: string; email: string; status: string;
    academy_batches: { batch_name: string } | null;
  } | null;
};
type AcademyApplication = NonNullable<Plan['academy_applications']>;

const STATUS_CHIP: Record<string, { bg: string; color: string; label: string }> = {
  pending:   { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b',  label: 'Pending Review' },
  approved:  { bg: 'rgba(16,185,129,0.12)', color: '#10b981',  label: 'Approved' },
  rejected:  { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444',  label: 'Rejected' },
  waitlisted:{ bg: 'rgba(99,102,241,0.12)', color: '#6366f1',  label: 'Waitlisted' },
};

const PAYMENT_CHIP: Record<string, { bg: string; color: string }> = {
  pending: { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
  paid:    { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  overdue: { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
  waived:  { bg: 'rgba(100,116,139,0.12)', color: '#64748b' },
};

function AcademyDashboardShell({ children }: { children: ReactNode }) {
  return (
    <Layout
      headerStyle={1}
      footerStyle={2}
      onePageNav={false}
      breadcrumbTitle="Film Academy Dashboard"
      breadcrumbClassName={undefined}
      breadcrumbPadding={undefined}
    >
      <section className="about-section section-padding fix bg-cover" style={{ backgroundImage: 'url("/assets/img/service/service-bg-2.jpg")' }}>
        <div className="container">
          <div className="service-details-wrapper">
            <div className="row g-4">
              <div className="col-12 col-lg-4">
                <div className="main-sidebar">
                  <div className="single-sidebar-widget">
                    <div className="wid-title">
                      <h3>Academy Menu</h3>
                    </div>
                    <div className="widget-categories">
                      <ul>
                        <li className="active">
                          <Link href="/film-academy/dashboard">My Dashboard</Link>
                          <i className="fa-solid fa-arrow-right-long" />
                        </li>
                        <li>
                          <Link href="/apply/film-academy">Apply to Academy</Link>
                          <i className="fa-solid fa-arrow-right-long" />
                        </li>
                        <li>
                          <Link href="/service-details/film-academy">Film Academy Details</Link>
                          <i className="fa-solid fa-arrow-right-long" />
                        </li>
                        <li>
                          <Link href="/my-applications">My Applications</Link>
                          <i className="fa-solid fa-arrow-right-long" />
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div className="single-sidebar-widget">
                    <div className="wid-title">
                      <h3>Dashboard Notes</h3>
                    </div>
                    <div className="opening-category">
                      <ul>
                        <li>
                          <i className="fa-regular fa-circle-check" />
                          Track your Film Academy application status
                        </li>
                        <li>
                          <i className="fa-regular fa-circle-check" />
                          Review installment schedules after approval
                        </li>
                        <li>
                          <i className="fa-regular fa-circle-check" />
                          Keep your email and phone number active
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div className="single-sidebar-image bg-cover" style={{ backgroundImage: 'url("/assets/img/service/post.jpg")' }}>
                    <div className="contact-text">
                      <div className="icon">
                        <i className="fa-solid fa-phone" />
                      </div>
                      <h4>Need academy support?</h4>
                      <h5>
                        <Link href="/contact">Contact Spotlight</Link>
                      </h5>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-lg-8">
                <div className="service-details-items">
                  <div className="details-content">{children}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

export default function AcademyDashboardPage() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [application, setApplication] = useState<AcademyApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payingId, setPayingId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/academy/installments', { headers: await authHeaders() });
        if (res.status === 401) { window.location.href = '/login?next=/film-academy/dashboard'; return; }
        const json = await res.json().catch(() => ({}));
        setPlan(json.plan ?? null);
        setApplication(json.application ?? json.plan?.academy_applications ?? null);
      } catch (e) {
        setError('Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function payInstallment(payment: Payment) {
    if (!plan) return;
    setPayingId(payment.id);
    try {
      const app = plan.academy_applications;
      if (!app) throw new Error('Application not found');

      const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';
      if (!publicKey || publicKey.includes('placeholder')) {
        throw new Error('Payment gateway not configured. Contact support.');
      }

      const PaystackPop = await loadPaystackClient();
      const handler = new PaystackPop();

      handler.newTransaction({
        key: publicKey,
        email: app.email,
        amount: payment.amount_ngn * 100,
        currency: 'NGN',
        metadata: {
          custom_fields: [
            { display_name: 'Plan', variable_name: 'plan_id', value: plan.id },
            { display_name: 'Installment', variable_name: 'installment_number', value: String(payment.installment_number) },
          ],
        },
        onSuccess: async (tx) => {
          try {
            const verRes = await fetch('/api/academy/installments/pay', {
              method: 'POST',
              headers: await authHeaders(true),
              body: JSON.stringify({ planId: plan.id, paymentId: payment.id, reference: tx.reference }),
            });
            const verJson = await verRes.json().catch(() => ({}));
            if (!verRes.ok) throw new Error(verJson?.error || 'Verification failed');

            setPlan((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                academy_installment_payments: prev.academy_installment_payments.map((p) =>
                  p.id === payment.id ? { ...p, status: 'paid', paid_at: new Date().toISOString() } : p,
                ),
              };
            });
            setToast(`✓ Installment #${payment.installment_number} paid successfully!`);
            setTimeout(() => setToast(''), 5000);
          } catch (e) {
            setToast(`⚠ ${e instanceof Error ? e.message : 'Payment confirmed but verification failed'}`);
          } finally {
            setPayingId(null);
          }
        },
        onCancel: () => setPayingId(null),
        onError: (e) => { setToast(`⚠ ${e.message}`); setPayingId(null); },
      });
    } catch (e) {
      setToast(`⚠ ${e instanceof Error ? e.message : 'Payment failed'}`);
      setPayingId(null);
    }
  }

  if (loading) return (
    <AcademyDashboardShell>
      <section style={{ minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg,#0d0d1a 0%,#14102b 100%)', borderRadius: 16 }}>
        <p style={{ color: 'rgba(255,255,255,0.55)' }}>Loading your dashboard...</p>
      </section>
    </AcademyDashboardShell>
  );

  if (error) return (
    <AcademyDashboardShell>
      <section style={{ minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg,#0d0d1a 0%,#14102b 100%)', borderRadius: 16 }}>
        <p style={{ color: '#ef4444' }}>{error}</p>
      </section>
    </AcademyDashboardShell>
  );

  const app = plan?.academy_applications ?? application;
  const payments = (plan?.academy_installment_payments ?? []).sort((a, b) => a.installment_number - b.installment_number);
  const totalPaid = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount_ngn, 0);
  const totalDue  = payments.filter((p) => ['pending','overdue'].includes(p.status)).reduce((s, p) => s + p.amount_ngn, 0);
  const nextDue   = payments.find((p) => p.status === 'pending' || p.status === 'overdue');

  return (
    <AcademyDashboardShell>
      <section style={{ background: 'linear-gradient(160deg,#0d0d1a 0%,#14102b 60%,#0d0d1a 100%)', borderRadius: 16, padding: 24 }}>
      <div style={{ maxWidth: '100%', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 11, color: 'rgba(245,158,11,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
            🎬 Spotlight Film Academy
          </p>
          <h1 style={{ color: '#fff', fontWeight: 800, fontSize: 'clamp(1.5rem,4vw,2rem)', marginBottom: 4 }}>
            {app?.full_name ?? 'My Dashboard'}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.5)' }}>
            {app?.academy_batches?.batch_name ?? 'Film Academy'}
          </p>
        </div>

        {toast && (
          <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 10, fontSize: 13,
            background: toast.startsWith('✓') ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${toast.startsWith('✓') ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: toast.startsWith('✓') ? '#10b981' : '#ef4444' }}>
            {toast}
          </div>
        )}

        {/* Application status */}
        {app && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '20px 24px', marginBottom: 20 }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Application Status</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {(() => {
                const sc = STATUS_CHIP[app.status] ?? STATUS_CHIP.pending;
                return <span style={{ fontSize: 13, fontWeight: 700, padding: '5px 16px', borderRadius: 20, background: sc.bg, color: sc.color }}>{sc.label}</span>;
              })()}
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 0 }}>{app.email}</p>
            </div>
            {app.status === 'approved' && !plan && (
              <p style={{ color: '#f59e0b', fontSize: 13, marginTop: 10 }}>
                Your application is approved. A training fee installment plan will be set up for you shortly.
              </p>
            )}
          </div>
        )}

        {!plan && !app && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '40px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 40, marginBottom: 12 }}>🎬</p>
            <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 16 }}>You haven&apos;t applied to the Film Academy yet.</p>
            <Link href="/apply/film-academy" style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontWeight: 700, padding: '12px 28px', borderRadius: 10, textDecoration: 'none', display: 'inline-block' }}>
              Apply Now
            </Link>
          </div>
        )}

        {plan && (
          <>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Total Fee',    value: fmt(plan.total_amount_ngn), color: '#f59e0b' },
                { label: 'Paid So Far',  value: fmt(totalPaid),             color: '#10b981' },
                { label: 'Outstanding',  value: fmt(totalDue),              color: totalDue > 0 ? '#ef4444' : '#10b981' },
                { label: 'Installments', value: `${payments.filter((p) => p.status === 'paid').length}/${plan.installments_count}`, color: '#6366f1' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px 20px' }}>
                  <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{label}</p>
                  <p style={{ fontSize: 20, fontWeight: 800, color, marginBottom: 0 }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Next payment CTA */}
            {nextDue && (
              <div style={{ background: 'linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.05))', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 16, padding: '20px 24px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <p style={{ color: '#f59e0b', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                    {nextDue.status === 'overdue' ? '⚠ Overdue Payment' : '⏰ Next Payment Due'}
                  </p>
                  <p style={{ color: '#fff', fontSize: 20, fontWeight: 800, marginBottom: 2 }}>{fmt(nextDue.amount_ngn)}</p>
                  <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 0 }}>
                    Installment #{nextDue.installment_number} · Due {nextDue.due_date}
                  </p>
                </div>
                <button
                  onClick={() => payInstallment(nextDue)}
                  disabled={payingId === nextDue.id}
                  style={{
                    background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontWeight: 800,
                    fontSize: 15, padding: '12px 28px', borderRadius: 10, border: 'none',
                    cursor: payingId === nextDue.id ? 'not-allowed' : 'pointer',
                    opacity: payingId === nextDue.id ? 0.7 : 1,
                    boxShadow: '0 4px 20px rgba(245,158,11,0.35)',
                  }}
                >
                  {payingId === nextDue.id ? 'Opening payment…' : 'Pay Now'}
                </button>
              </div>
            )}

            {/* All installments */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <h2 style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginBottom: 0 }}>Payment Schedule</h2>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {['#', 'Amount', 'Due Date', 'Status', 'Action'].map((h) => (
                        <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.35)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => {
                      const pc = PAYMENT_CHIP[p.status] ?? PAYMENT_CHIP.pending;
                      const isOverdue = p.status !== 'paid' && new Date(p.due_date) < new Date();
                      return (
                        <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '12px 16px', color: '#fff', fontWeight: 700 }}>{p.installment_number}</td>
                          <td style={{ padding: '12px 16px', color: '#f59e0b', fontWeight: 700 }}>{fmt(p.amount_ngn)}</td>
                          <td style={{ padding: '12px 16px', color: isOverdue ? '#ef4444' : 'rgba(255,255,255,0.6)' }}>{p.due_date}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: pc.bg, color: pc.color }}>
                              {p.status}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            {(p.status === 'pending' || p.status === 'overdue') ? (
                              <button
                                onClick={() => payInstallment(p)}
                                disabled={!!payingId}
                                style={{ fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 7, border: 'none',
                                  background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000',
                                  cursor: payingId ? 'not-allowed' : 'pointer', opacity: payingId ? 0.6 : 1 }}
                              >
                                {payingId === p.id ? '…' : 'Pay'}
                              </button>
                            ) : (
                              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
                                {p.paid_at ? `Paid ${new Date(p.paid_at).toLocaleDateString('en-NG')}` : '—'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {plan.status === 'completed' && (
                <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                  <p style={{ color: '#10b981', fontWeight: 700, marginBottom: 0 }}>🎉 All installments paid — training fee complete!</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      </section>
    </AcademyDashboardShell>
  );
}
