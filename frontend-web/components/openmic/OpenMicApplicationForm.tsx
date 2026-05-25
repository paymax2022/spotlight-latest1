'use client';

import { useState } from 'react';
import Link from 'next/link';

type Props = {
  contestSlug: string;
  requiresPayment: boolean;
};

export default function OpenMicApplicationForm({ contestSlug, requiresPayment }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    fullName: '',
    stageName: '',
    email: '',
    phone: '',
    gender: 'prefer_not_to_say',
    ageRange: '18_24',
    city: 'Lagos',
    state: 'Lagos',
    musicGenre: 'Afrobeats',
    hasAgreedToRules: false,
    hasAgreedToBeatTerms: false,
    hasAgreedToVotingTerms: false,
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/open-mic/contests/${contestSlug}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.error || Object.values(payload?.errors || {}).join(' ') || 'Application failed.');
      }
      setMessage(requiresPayment
        ? 'Application submitted. Complete entry payment and await approval before beat download.'
        : 'Application submitted successfully. Beat access will be available after approval.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Application failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="form-shell">
        <p className="form-section-title">Artist Profile</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="form-label">Full Name*</label>
            <input className="form-input h-[44px]" value={form.fullName} onChange={(e) => setField('fullName', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Stage Name*</label>
            <input className="form-input h-[44px]" value={form.stageName} onChange={(e) => setField('stageName', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Email Address*</label>
            <input className="form-input h-[44px]" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Phone / WhatsApp*</label>
            <input className="form-input h-[44px]" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="form-shell space-y-2">
        <p className="form-section-title">Required Agreements</p>
        <label className="form-check-row"><input type="checkbox" checked={form.hasAgreedToRules} onChange={(e) => setField('hasAgreedToRules', e.target.checked)} /> <span>I agree to contest rules.</span></label>
        <label className="form-check-row"><input type="checkbox" checked={form.hasAgreedToBeatTerms} onChange={(e) => setField('hasAgreedToBeatTerms', e.target.checked)} /> <span>I agree to beat usage terms.</span></label>
        <label className="form-check-row"><input type="checkbox" checked={form.hasAgreedToVotingTerms} onChange={(e) => setField('hasAgreedToVotingTerms', e.target.checked)} /> <span>I agree to public voting terms.</span></label>
      </div>

      <div className="pt-1 flex gap-2 flex-wrap">
        <button type="button" className="btn-primary py-2.5 px-4 text-xs" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Submitting...' : 'Submit Application'}
        </button>
        <Link href={`/open-mic/${contestSlug}/enter`} className="btn-outline py-2.5 px-4 text-xs">
          Already Applied? Submit Song
        </Link>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
    </div>
  );
}
