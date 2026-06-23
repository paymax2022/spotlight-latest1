'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminAuthHeaders } from '@/src/lib/auth/client';

const SCHEDULES = [
  { value: 'weekdays', label: 'Weekdays (Mon-Fri)' },
  { value: 'weekends', label: 'Weekends (Sat-Sun)' },
  { value: 'accelerated', label: 'Accelerated (Intensive)' },
];
const STATUSES = ['upcoming', 'ongoing', 'completed', 'cancelled'];
const FREQUENCIES = [
  { value: 'upfront', label: 'Full payment upfront' },
  { value: 'monthly', label: 'Monthly installments' },
  { value: 'biweekly', label: 'Bi-weekly installments' },
  { value: 'weekly', label: 'Weekly installments' },
];

const input: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  boxSizing: 'border-box',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--foreground)',
  fontSize: 14,
  outline: 'none',
};
const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--foreground-muted)',
  display: 'block',
  marginBottom: 5,
};

type BatchFormState = {
  batch_name: string;
  start_date: string;
  training_schedule: 'weekdays' | 'weekends' | 'accelerated';
  duration_weeks: number;
  max_students: string | number;
  description: string;
  benefits: string;
  status: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  registration_free: boolean;
  training_fee_ngn: string | number;
  one_off_discount_pct: number;
  installments_count: number;
  fee_frequency: string;
  fee_start_offset_days: number;
};

type BatchFormProps = {
  mode: 'create' | 'edit';
  batchId?: string;
  initialBatch?: Record<string, any>;
};

function toDateInput(value: unknown) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function normalizeBenefits(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join('\n');
  return typeof value === 'string' ? value : '';
}

function getInitialForm(initialBatch?: Record<string, any>): BatchFormState {
  return {
    batch_name: String(initialBatch?.batch_name ?? ''),
    start_date: toDateInput(initialBatch?.start_date),
    training_schedule: (initialBatch?.training_schedule ?? 'weekdays') as BatchFormState['training_schedule'],
    duration_weeks: Number(initialBatch?.duration_weeks ?? 8),
    max_students: initialBatch?.max_students == null ? '' : Number(initialBatch.max_students),
    description: String(initialBatch?.description ?? ''),
    benefits: normalizeBenefits(initialBatch?.benefits),
    status: (initialBatch?.status ?? 'upcoming') as BatchFormState['status'],
    registration_free: true,
    training_fee_ngn: Number(initialBatch?.training_fee_ngn ?? 0) || '',
    one_off_discount_pct: Number(initialBatch?.one_off_discount_pct ?? 0),
    installments_count: Number(initialBatch?.installments_count ?? 3),
    fee_frequency: String(initialBatch?.fee_frequency ?? 'monthly'),
    fee_start_offset_days: Number(initialBatch?.fee_start_offset_days ?? 0),
  };
}

export default function AcademyBatchForm({ mode, batchId, initialBatch }: BatchFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<BatchFormState>(() => getInitialForm(initialBatch));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(key: keyof BatchFormState, value: unknown) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const trainingFee = form.training_fee_ngn === '' ? 0 : Number(form.training_fee_ngn);
      const payload = {
        ...form,
        max_students: form.max_students === '' ? null : Number(form.max_students),
        training_fee_ngn: trainingFee,
        one_off_discount_pct: Number(form.one_off_discount_pct),
        installments_count: trainingFee > 0 ? Number(form.installments_count) : 1,
        fee_frequency: trainingFee > 0 ? form.fee_frequency : 'upfront',
        fee_start_offset_days: Number(form.fee_start_offset_days),
        benefits: form.benefits ? form.benefits.split('\n').map((item) => item.trim()).filter(Boolean) : [],
      };

      const res = await fetch(
        mode === 'edit' && batchId ? `/api/admin/academy/batches/${batchId}` : '/api/admin/academy/batches',
        {
          method: mode === 'edit' ? 'PATCH' : 'POST',
          headers: await adminAuthHeaders(true),
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to ${mode === 'edit' ? 'update' : 'create'} batch`);
      router.push(mode === 'edit' && batchId ? `/admin/film-academy/batches/${batchId}` : '/admin/film-academy');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${mode === 'edit' ? 'update' : 'create'} batch`);
      setSaving(false);
    }
  }

  const isEdit = mode === 'edit';

  return (
    <div className="max-w-2xl mx-auto px-4 pb-10">
      <div className="flex items-center gap-3 mb-6">
        <Link href={isEdit && batchId ? `/admin/film-academy/batches/${batchId}` : '/admin/film-academy'} className="text-foreground/40 hover:text-foreground text-sm">
          {isEdit ? 'Back to Batch' : 'Film Academy'}
        </Link>
        <span className="text-foreground/20">/</span>
        <h1 className="font-display text-2xl text-foreground">{isEdit ? 'Edit Intake Batch' : 'New Intake Batch'}</h1>
      </div>

      <form onSubmit={submit} className="glass-card rounded-md p-6 space-y-5">
        <div>
          <label style={label}>Batch Name *</label>
          <input style={input} required value={form.batch_name} onChange={(event) => set('batch_name', event.target.value)} placeholder="e.g. Batch 2026 - June Intake" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label style={label}>Start Date *</label>
            <input style={input} type="date" required value={form.start_date} onChange={(event) => set('start_date', event.target.value)} />
          </div>
          <div>
            <label style={label}>Duration (weeks) *</label>
            <input style={input} type="number" min={1} required value={form.duration_weeks} onChange={(event) => set('duration_weeks', Number(event.target.value))} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label style={label}>Training Schedule *</label>
            <select style={input} value={form.training_schedule} onChange={(event) => set('training_schedule', event.target.value)}>
              {SCHEDULES.map((schedule) => <option key={schedule.value} value={schedule.value}>{schedule.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Max Students</label>
            <input style={input} type="number" min={1} value={form.max_students} onChange={(event) => set('max_students', event.target.value)} placeholder="Leave blank for unlimited" />
          </div>
        </div>

        <div>
          <label style={label}>Status</label>
          <select style={input} value={form.status} onChange={(event) => set('status', event.target.value)}>
            {STATUSES.map((status) => <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>)}
          </select>
        </div>

        <div>
          <label style={label}>Description</label>
          <textarea style={{ ...input, minHeight: 90, resize: 'vertical' }} value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="What will students learn in this batch?" />
        </div>

        <div>
          <label style={label}>Benefits (one per line)</label>
          <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} value={form.benefits} onChange={(event) => set('benefits', event.target.value)} placeholder={'Certificate of completion\nHands-on production experience\nIndustry mentorship'} />
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Registration (Application Fee)</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button type="button" onClick={() => set('registration_free', true)} style={{ flex: 1, padding: '10px', borderRadius: 8, border: `2px solid ${form.registration_free ? '#10b981' : 'var(--border)'}`, background: form.registration_free ? 'rgba(16,185,129,0.08)' : 'transparent', color: form.registration_free ? '#10b981' : 'var(--foreground-muted)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              Free Registration
            </button>
            <button type="button" onClick={() => set('registration_free', false)} style={{ flex: 1, padding: '10px', borderRadius: 8, border: `2px solid ${!form.registration_free ? '#f59e0b' : 'var(--border)'}`, background: !form.registration_free ? 'rgba(245,158,11,0.08)' : 'transparent', color: !form.registration_free ? '#f59e0b' : 'var(--foreground-muted)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              Paid Registration
            </button>
          </div>
          {!form.registration_free && (
            <p style={{ marginTop: 8, fontSize: 12, color: 'var(--foreground-muted)' }}>
              Application fee is configured in <Link href="/admin/film-academy/settings" style={{ color: 'var(--accent-gold)', fontWeight: 700 }}>Academy Settings</Link> and applies to all batches.
            </p>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Tuition Fee & Payment Options</p>
          <p style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 16 }}>
            Applicants choose between one-off payment with optional discount or installments at registration time.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label style={label}>Total Tuition Fee (NGN)</label>
              <input style={input} type="number" min={0} value={form.training_fee_ngn} onChange={(event) => set('training_fee_ngn', event.target.value)} placeholder="0 = free tuition" />
            </div>

            {Number(form.training_fee_ngn) > 0 && (
              <div>
                <label style={label}>One-Off Payment Discount (%)</label>
                <input style={input} type="number" min={0} max={100} step={0.5} value={form.one_off_discount_pct} onChange={(event) => set('one_off_discount_pct', Math.min(100, Math.max(0, Number(event.target.value))))} placeholder="0 = no discount" />
                <p style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4 }}>Applied when applicant pays the full amount at once.</p>
              </div>
            )}
          </div>

          {Number(form.training_fee_ngn) > 0 && (
            <>
              <p style={{ marginTop: 16, fontWeight: 600, fontSize: 13 }}>Installment Plan</p>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <label style={label}>Number of Installments</label>
                  <input style={input} type="number" min={2} max={12} value={form.installments_count} onChange={(event) => set('installments_count', Number(event.target.value))} />
                </div>
                <div>
                  <label style={label}>Installment Frequency</label>
                  <select style={input} value={form.fee_frequency} onChange={(event) => set('fee_frequency', event.target.value)}>
                    {FREQUENCIES.filter((frequency) => frequency.value !== 'upfront').map((frequency) => <option key={frequency.value} value={frequency.value}>{frequency.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>First Installment Due (days after approval)</label>
                  <input style={input} type="number" min={0} value={form.fee_start_offset_days} onChange={(event) => set('fee_start_offset_days', Number(event.target.value))} placeholder="0 = immediately on approval" />
                </div>
              </div>

              <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 10, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', fontSize: 13 }}>
                <p style={{ fontWeight: 700, marginBottom: 8 }}>What applicants will see at registration:</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>Pay in full{form.one_off_discount_pct > 0 ? ` (save ${form.one_off_discount_pct}%)` : ''}</span>
                    <strong style={{ color: form.one_off_discount_pct > 0 ? '#10b981' : undefined }}>
                      NGN {Math.round(Number(form.training_fee_ngn) * (1 - form.one_off_discount_pct / 100)).toLocaleString()}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>Pay in {form.installments_count} {form.fee_frequency} installments</span>
                    <strong>NGN {Math.round(Number(form.training_fee_ngn) / form.installments_count).toLocaleString()} each</strong>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {error && <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{error}</div>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary py-2.5 px-6 text-sm" style={{ opacity: saving ? 0.6 : 1 }}>
            {saving ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Batch')}
          </button>
          <Link href={isEdit && batchId ? `/admin/film-academy/batches/${batchId}` : '/admin/film-academy'} className="btn-outline py-2.5 px-4 text-sm">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
