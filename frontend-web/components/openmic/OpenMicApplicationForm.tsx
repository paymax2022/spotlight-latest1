'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getOpenMicLgaOptions, OPEN_MIC_COUNTRIES, OPEN_MIC_STATES } from '@/src/features/openmic/location-options';

type Props = {
  contestSlug: string;
  requiresPayment: boolean;
};

export default function OpenMicApplicationForm({ contestSlug, requiresPayment }: Props) {
  const supabase = createClient();
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
    country: 'Nigeria',
    state: '',
    lga: '',
    city: '',
    hasAgreedToRules: false,
    hasAgreedToBeatTerms: false,
    hasAgreedToVotingTerms: false,
    artistBio: '',
    instagramHandle: '',
    tiktokHandle: '',
    youtubeHandle: '',
    facebookHandle: '',
    xHandle: '',
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'state' ? { lga: '' } : {}),
    }));
  }

  const lgaOptions = getOpenMicLgaOptions(form.state);

  async function submit() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Please sign in to apply.');
      const hasSocialHandle = [
        form.instagramHandle,
        form.tiktokHandle,
        form.youtubeHandle,
        form.facebookHandle,
        form.xHandle,
      ].some((value) => value.trim());
      if (!form.country.trim() || !form.state.trim() || !form.lga.trim()) {
        throw new Error('Country, state, and LGA are required.');
      }
      if (!hasSocialHandle) {
        throw new Error('Provide at least one social media handle.');
      }

      const res = await fetch(`/api/open-mic/contests/${contestSlug}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
          <div>
            <label className="form-label">Country*</label>
            <select className="form-input h-[44px]" value={form.country} onChange={(e) => setField('country', e.target.value)}>
              <option value="">Select country</option>
              {OPEN_MIC_COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">State*</label>
            <select className="form-input h-[44px]" value={form.state} onChange={(e) => setField('state', e.target.value)}>
              <option value="">Select state</option>
              {OPEN_MIC_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">LGA*</label>
            <select className="form-input h-[44px]" value={form.lga} onChange={(e) => setField('lga', e.target.value)} disabled={!form.state}>
              <option value="">{form.state ? 'Select LGA' : 'Select state first'}</option>
              {lgaOptions.map((lga) => (
                <option key={lga} value={lga}>
                  {lga}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">City / Area</label>
            <input className="form-input h-[44px]" value={form.city} onChange={(e) => setField('city', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Instagram</label>
            <input className="form-input h-[44px]" value={form.instagramHandle} onChange={(e) => setField('instagramHandle', e.target.value)} />
          </div>
          <div>
            <label className="form-label">TikTok</label>
            <input className="form-input h-[44px]" value={form.tiktokHandle} onChange={(e) => setField('tiktokHandle', e.target.value)} />
          </div>
          <div>
            <label className="form-label">YouTube</label>
            <input className="form-input h-[44px]" value={form.youtubeHandle} onChange={(e) => setField('youtubeHandle', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Facebook</label>
            <input className="form-input h-[44px]" value={form.facebookHandle} onChange={(e) => setField('facebookHandle', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">X / Twitter</label>
            <input className="form-input h-[44px]" value={form.xHandle} onChange={(e) => setField('xHandle', e.target.value)} />
            <p className="form-help">At least one social media handle is required.</p>
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Artist Bio</label>
            <textarea className="form-input min-h-[90px]" value={form.artistBio} onChange={(e) => setField('artistBio', e.target.value)} />
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
