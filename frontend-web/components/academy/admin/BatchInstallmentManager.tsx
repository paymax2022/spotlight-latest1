'use client';

import { useState } from 'react';
import { adminAuthHeaders } from '@/src/lib/auth/client';

type Payment = {
  id: string; installment_number: number; amount_ngn: number;
  due_date: string; status: string; paid_at?: string; reminder_count: number;
};
type Plan = {
  id: string; total_amount_ngn: number; installments_count: number;
  frequency: string; status: string;
  academy_applications: { full_name: string; email: string } | null;
  academy_installment_payments: Payment[];
};

const fmt = (n: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(n);

const PCHIP: Record<string, { bg: string; color: string }> = {
  pending: { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
  paid:    { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  overdue: { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
  waived:  { bg: 'rgba(100,116,139,0.12)', color: '#64748b' },
};

function PlanRow({ plan, onRemind, reminding }: { plan: Plan; onRemind: (id: string) => void; reminding: boolean }) {
  const [open, setOpen] = useState(false);
  const app = plan.academy_applications;
  const paidCount  = plan.academy_installment_payments.filter((p) => p.status === 'paid').length;
  const totalPaid  = plan.academy_installment_payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount_ngn, 0);
  const hasPending = plan.academy_installment_payments.some((p) => ['pending','overdue'].includes(p.status));

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {/* Summary row */}
      <div onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', cursor: 'pointer', background: 'var(--bg-card)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 1 }}>{app?.full_name ?? '—'}</p>
          <p style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 0 }}>{app?.email ?? ''}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontWeight: 700, fontSize: 14, color: '#f59e0b', marginBottom: 1 }}>
            {(plan as any).discounted_amount_ngn
              ? fmt((plan as any).discounted_amount_ngn)
              : fmt(plan.total_amount_ngn)}
            {(plan as any).discount_applied_pct > 0 && (
              <span style={{ fontSize: 10, color: '#10b981', marginLeft: 6, fontWeight: 700 }}>
                ({(plan as any).discount_applied_pct}% off)
              </span>
            )}
          </p>
          <p style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 0 }}>
            {fmt(totalPaid)} paid · {paidCount}/{plan.installments_count} · {(plan as any).plan_type === 'one_off' ? '💳 one-off' : `📅 ${plan.frequency}`}
          </p>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, flexShrink: 0,
          background: plan.status === 'completed' ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.12)',
          color: plan.status === 'completed' ? '#10b981' : '#6366f1',
        }}>{plan.status}</span>
        <span style={{ color: 'var(--foreground-muted)', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['#', 'Amount', 'Due Date', 'Status', 'Paid On', 'Reminders'].map((h) => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--foreground-muted)', fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...plan.academy_installment_payments]
                  .sort((a, b) => a.installment_number - b.installment_number)
                  .map((p) => {
                    const sc = PCHIP[p.status] ?? PCHIP.pending;
                    const isLate = p.status !== 'paid' && new Date(p.due_date) < new Date();
                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 10px' }}>{p.installment_number}</td>
                        <td style={{ padding: '7px 10px', fontWeight: 600 }}>{fmt(p.amount_ngn)}</td>
                        <td style={{ padding: '7px 10px', color: isLate ? '#ef4444' : 'inherit' }}>{p.due_date}</td>
                        <td style={{ padding: '7px 10px' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: sc.bg, color: sc.color }}>{p.status}</span>
                        </td>
                        <td style={{ padding: '7px 10px', color: 'var(--foreground-muted)', fontSize: 12 }}>
                          {p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-NG') : '—'}
                        </td>
                        <td style={{ padding: '7px 10px', color: 'var(--foreground-muted)' }}>{p.reminder_count}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {hasPending && (
            <button onClick={() => onRemind(plan.id)} disabled={reminding}
              style={{ marginTop: 10, fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 7,
                border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground)',
                cursor: reminding ? 'not-allowed' : 'pointer', opacity: reminding ? 0.6 : 1 }}>
              {reminding ? '📧 Sending…' : '📧 Send Payment Reminder'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function BatchInstallmentManager({
  batchId, plans: initialPlans,
  batchFee,
}: {
  batchId: string;
  applications: { id: string; full_name: string }[];
  plans: Plan[];
  batchFee?: { training_fee_ngn: number; installments_count: number; fee_frequency: string };
}) {
  const [plans, setPlans] = useState<Plan[]>(initialPlans);
  const [reminding, setReminding] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  async function handleRemind(planId: string) {
    setReminding(planId);
    try {
      const res = await fetch(`/api/admin/academy/installments/${planId}/remind`, {
        method: 'POST', headers: await adminAuthHeaders(true),
      });
      const json = await res.json().catch(() => ({}));
      setToast(res.ok ? `✓ Reminder sent to ${json.email}` : `⚠ ${json.error || 'Failed'}`);
    } finally {
      setReminding(null);
      setTimeout(() => setToast(''), 5000);
    }
  }

  const hasFee = batchFee && batchFee.training_fee_ngn > 0;

  return (
    <div className="glass-card rounded-md overflow-hidden">
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold text-foreground">Training Fee Payments</h2>
        {hasFee ? (
          <p className="text-xs text-foreground/40 mt-0.5">
            All approved applicants are automatically assigned this batch&apos;s fee structure:{' '}
            <strong>
              {new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(batchFee.training_fee_ngn)}
            </strong>
            {batchFee.installments_count > 1 && ` in ${batchFee.installments_count} ${batchFee.fee_frequency} installments`}
          </p>
        ) : (
          <p className="text-xs text-foreground/40 mt-0.5">
            No training fee configured for this batch. Edit the batch to add a fee structure.
          </p>
        )}
      </div>

      {toast && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 13,
          background: toast.startsWith('✓') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
          color: toast.startsWith('✓') ? '#10b981' : '#ef4444' }}>
          {toast}
        </div>
      )}

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {plans.length === 0 ? (
          <p className="text-sm text-foreground/40 text-center py-6">
            {hasFee
              ? 'No installment plans yet — plans are created automatically when applicants are approved.'
              : 'Set a training fee on the batch to enable installment tracking.'}
          </p>
        ) : (
          plans.map((plan) => (
            <PlanRow
              key={plan.id} plan={plan}
              onRemind={handleRemind}
              reminding={reminding === plan.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
