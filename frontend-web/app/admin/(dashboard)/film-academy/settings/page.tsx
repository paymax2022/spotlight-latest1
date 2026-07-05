'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { adminAuthHeaders } from '@/src/lib/auth/client';

type AcademySettings = {
  id: string | null;
  registration_type: 'free' | 'paid';
  application_fee: number;
  application_fee_refundable: boolean;
  tuition_fee: number;
  is_active: boolean;
};

const emptySettings: AcademySettings = {
  id: null,
  registration_type: 'free',
  application_fee: 0,
  application_fee_refundable: false,
  tuition_fee: 0,
  is_active: true,
};

const inputStyle: React.CSSProperties = {
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

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--foreground-muted)',
  display: 'block',
  marginBottom: 6,
};

function normalizeAmount(value: string) {
  if (value.trim() === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
}

export default function AcademySettingsPage() {
  const [form, setForm] = useState<AcademySettings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const applicationFeeValue = useMemo(
    () => String(Number(form.application_fee || 0)),
    [form.application_fee],
  );
  const tuitionFeeValue = useMemo(() => String(Number(form.tuition_fee || 0)), [form.tuition_fee]);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setLoading(true);
      setError('');

      try {
        const res = await fetch('/api/admin/academy/settings', {
          headers: await adminAuthHeaders(),
          cache: 'no-store',
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'Failed to load academy settings');
        if (!cancelled) setForm({ ...emptySettings, ...(json.settings ?? {}) });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load academy settings');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  function set<K extends keyof AcademySettings>(key: K, value: AcademySettings[K]) {
    setNotice('');
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');

    const applicationFee = normalizeAmount(String(form.application_fee));
    const tuitionFee = normalizeAmount(String(form.tuition_fee));

    if (!Number.isFinite(applicationFee) || !Number.isFinite(tuitionFee)) {
      setError('Fees must be valid positive amounts.');
      setSaving(false);
      return;
    }

    try {
      const payload = {
        registration_type: form.registration_type,
        application_fee: form.registration_type === 'paid' ? applicationFee : 0,
        application_fee_refundable: form.application_fee_refundable,
        tuition_fee: tuitionFee,
      };
      const res = await fetch('/api/admin/academy/settings', {
        method: 'PUT',
        headers: await adminAuthHeaders(true),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Failed to save academy settings');
      setForm({ ...emptySettings, ...(json.settings ?? payload) });
      setNotice('Academy settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save academy settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-10">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/film-academy" className="text-foreground/40 hover:text-foreground text-sm">
          Film Academy
        </Link>
        <span className="text-foreground/20">/</span>
        <h1 className="font-display text-2xl text-foreground">Academy Settings</h1>
      </div>

      <form onSubmit={submit} className="glass-card rounded-md p-6 space-y-5">
        <div>
          <p className="text-sm text-foreground/60 mb-4">
            Configure the global Film Academy application fee. New applications use this setting to
            decide whether payment is required before review.
          </p>

          {loading ? (
            <div className="text-sm text-foreground/50">Loading settings...</div>
          ) : (
            <>
              <div>
                <label style={labelStyle}>Registration Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => set('registration_type', 'free')}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 8,
                      border: `2px solid ${form.registration_type === 'free' ? '#10b981' : 'var(--border)'}`,
                      background: form.registration_type === 'free' ? 'rgba(16,185,129,0.08)' : 'transparent',
                      color: form.registration_type === 'free' ? '#10b981' : 'var(--foreground-muted)',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Free
                  </button>
                  <button
                    type="button"
                    onClick={() => set('registration_type', 'paid')}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 8,
                      border: `2px solid ${form.registration_type === 'paid' ? '#f59e0b' : 'var(--border)'}`,
                      background: form.registration_type === 'paid' ? 'rgba(245,158,11,0.08)' : 'transparent',
                      color: form.registration_type === 'paid' ? '#f59e0b' : 'var(--foreground-muted)',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Paid
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mt-5">
                <div>
                  <label style={labelStyle}>Application Fee (NGN)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    min={0}
                    step="0.01"
                    disabled={form.registration_type === 'free'}
                    value={applicationFeeValue}
                    onChange={(event) => set('application_fee', Number(event.target.value))}
                  />
                  <p className="text-xs text-foreground/40 mt-1">
                    Set registration type to paid to collect this fee.
                  </p>
                </div>

                <div>
                  <label style={labelStyle}>Default Tuition Fee (NGN)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    min={0}
                    step="0.01"
                    value={tuitionFeeValue}
                    onChange={(event) => set('tuition_fee', Number(event.target.value))}
                  />
                  <p className="text-xs text-foreground/40 mt-1">
                    Batch-level training fees can still override tuition setup.
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-3 mt-5 text-sm text-foreground/70">
                <input
                  type="checkbox"
                  checked={form.application_fee_refundable}
                  onChange={(event) => set('application_fee_refundable', event.target.checked)}
                />
                Application fee is refundable
              </label>
            </>
          )}
        </div>

        {error ? (
          <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="text-sm text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-3 py-2">
            {notice}
          </div>
        ) : null}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading || saving}
            className="btn-primary py-2.5 px-6 text-sm"
            style={{ opacity: loading || saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          <Link href="/admin/film-academy" className="btn-outline py-2.5 px-4 text-sm">
            Back
          </Link>
        </div>
      </form>
    </div>
  );
}
