'use client';

import { useEffect, useState } from 'react';
import { authHeaders } from '@/src/lib/auth/client';
import { getOpenMicLgaOptions, OPEN_MIC_COUNTRIES, OPEN_MIC_STATES } from '@/src/features/openmic/location-options';

const profileTypes = [
  ['artist', 'Artist'],
  ['student', 'Student'],
  ['school_representative', 'School Representative'],
  ['sme_founder', 'SME Founder'],
  ['football_talent', 'Football Talent'],
  ['actor', 'Actor'],
  ['content_creator', 'Content Creator'],
  ['parent_guardian', 'Parent/Guardian'],
  ['general_applicant', 'General Applicant'],
];

const genderOptions = [
  ['', 'Select gender'],
  ['female', 'Female'],
  ['male', 'Male'],
  ['non_binary', 'Non-binary'],
  ['prefer_not_to_say', 'Prefer not to say'],
];

function normalizeNigeriaPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('234')) return `+${digits.slice(0, 13)}`;
  if (digits.startsWith('0')) return `+234${digits.slice(1, 11)}`;
  return `+234${digits.slice(0, 10)}`;
}

function isValidNigeriaPhone(value: string) {
  return /^\+234[789]\d{9}$/.test(normalizeNigeriaPhone(value));
}

export default function ProfileEditorClient() {
  const [form, setForm] = useState<Record<string, any>>({ profileTypes: ['general_applicant'], social: {} });
  const [completion, setCompletion] = useState<Record<string, any>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function setField(key: string, value: unknown) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'state' ? { lga: '' } : {}),
    }));
  }

  const lgaOptions = getOpenMicLgaOptions(String(form.state || ''));

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/me/profile', { headers: await authHeaders(), cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Unable to load profile.');
      setForm({ ...(payload.profile || {}), social: payload.profile?.social || {}, profileTypes: payload.profile?.profileTypes || ['general_applicant'] });
      setCompletion(payload.completion || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load profile.');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setMessage('');
    setError('');
    try {
      if (form.phone && !isValidNigeriaPhone(String(form.phone))) {
        throw new Error('Enter a valid Nigerian mobile number.');
      }
      const res = await fetch('/api/me/profile', {
        method: 'PUT',
        headers: await authHeaders(true),
        body: JSON.stringify(form),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Unable to save profile.');
      setForm(payload.profile || form);
      setCompletion(payload.completion || {});
      setMessage('Profile saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <p>Loading profile...</p>;

  return (
    <div className="glass-card rounded-md p-4">
      {error ? <p className="text-red-400 font-semibold">{error}</p> : null}
      {message ? <p className="text-emerald-400 font-semibold">{message}</p> : null}
      <div className="mb-4">
        <p className="mb-1">Profile Completion: <strong>{Number(completion.percentage || 0)}%</strong></p>
        {Array.isArray(completion.missingRequired) && completion.missingRequired.length ? (
          <p className="text-sm text-foreground/70 mb-0">Missing required fields: {completion.missingRequired.join(', ')}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          ['firstName', 'First Name'],
          ['lastName', 'Last Name'],
          ['displayName', 'Display Name'],
        ].map(([key, label]) => (
          <label key={key} className="d-block">
            <span className="form-label">{label}</span>
            <input className="form-input h-[44px]" value={form[key] || ''} onChange={(e) => setField(key, e.target.value)} />
          </label>
        ))}
        <label className="d-block">
          <span className="form-label">Gender</span>
          <select className="form-input h-[44px]" value={form.gender || ''} onChange={(e) => setField('gender', e.target.value)}>
            {genderOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="d-block">
          <span className="form-label">Date of Birth</span>
          <input className="form-input h-[44px]" type="date" value={form.dateOfBirth || ''} onChange={(e) => setField('dateOfBirth', e.target.value)} />
        </label>
        <label className="d-block">
          <span className="form-label">Phone Number</span>
          <div className="d-flex align-items-center gap-2">
            <span className="form-input h-[44px] d-inline-flex align-items-center justify-content-center" style={{ width: 92 }}>🇳🇬 +234</span>
            <input
              className="form-input h-[44px]"
              inputMode="tel"
              placeholder="8012345678"
              value={String(form.phone || '').replace(/^\+234/, '')}
              onChange={(e) => setField('phone', normalizeNigeriaPhone(e.target.value))}
              onBlur={(e) => setField('phone', normalizeNigeriaPhone(e.target.value))}
            />
          </div>
          {form.phone && !isValidNigeriaPhone(String(form.phone)) ? <p className="form-error">Enter a valid Nigerian mobile number.</p> : null}
        </label>
        <label className="d-block">
          <span className="form-label">WhatsApp Number</span>
          <div className="d-flex align-items-center gap-2">
            <span className="form-input h-[44px] d-inline-flex align-items-center justify-content-center" style={{ width: 92 }}>🇳🇬 +234</span>
            <input
              className="form-input h-[44px]"
              inputMode="tel"
              placeholder="8012345678"
              value={String(form.whatsapp || '').replace(/^\+234/, '')}
              onChange={(e) => setField('whatsapp', normalizeNigeriaPhone(e.target.value))}
              onBlur={(e) => setField('whatsapp', normalizeNigeriaPhone(e.target.value))}
            />
          </div>
        </label>
        <label className="d-block">
          <span className="form-label">Country</span>
          <select className="form-input h-[44px]" value={form.country || 'Nigeria'} onChange={(e) => setField('country', e.target.value)}>
            <option value="">Select country</option>
            {OPEN_MIC_COUNTRIES.map((country) => (
              <option key={country} value={country}>{country}</option>
            ))}
          </select>
        </label>
        <label className="d-block">
          <span className="form-label">State</span>
          <select className="form-input h-[44px]" value={form.state || ''} onChange={(e) => setField('state', e.target.value)}>
            <option value="">Select state</option>
            {OPEN_MIC_STATES.map((state) => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
        </label>
        <label className="d-block">
          <span className="form-label">LGA</span>
          <select className="form-input h-[44px]" value={form.lga || ''} onChange={(e) => setField('lga', e.target.value)} disabled={!form.state}>
            <option value="">{form.state ? 'Select LGA' : 'Select state first'}</option>
            {lgaOptions.map((lga) => (
              <option key={lga} value={lga}>{lga}</option>
            ))}
          </select>
        </label>
        {[
          ['city', 'City / Area'],
          ['address', 'Address'],
          ['profilePhotoUrl', 'Profile Photo URL'],
          ['preferredCategory', 'Preferred Spotlight Category'],
          ['emergencyContactName', 'Emergency Contact Name'],
          ['emergencyContactPhone', 'Emergency Contact Phone'],
        ].map(([key, label]) => (
          <label key={key} className="d-block">
            <span className="form-label">{label}</span>
            <input className="form-input h-[44px]" value={form[key] || ''} onChange={(e) => setField(key, e.target.value)} />
          </label>
        ))}
        <label className="d-block md:col-span-2">
          <span className="form-label">Bio / About Me</span>
          <textarea className="form-input min-h-[110px]" value={form.bio || ''} onChange={(e) => setField('bio', e.target.value)} />
        </label>
      </div>

      <div className="mt-4">
        <p className="form-label">Profile Types</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {profileTypes.map(([value, label]) => (
            <label key={value} className="form-check-row">
              <input
                type="checkbox"
                checked={(form.profileTypes || []).includes(value)}
                onChange={(e) => {
                  const current = new Set<string>(form.profileTypes || []);
                  if (e.target.checked) current.add(value);
                  else current.delete(value);
                  setField('profileTypes', Array.from(current));
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="form-label">Social Handles</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {['instagram', 'tiktok', 'youtube', 'facebook', 'twitter'].map((key) => (
            <input
              key={key}
              className="form-input h-[44px]"
              placeholder={key}
              value={form.social?.[key] || ''}
              onChange={(e) => setField('social', { ...(form.social || {}), [key]: e.target.value })}
            />
          ))}
        </div>
      </div>

      <label className="form-check-row mt-4">
        <input type="checkbox" checked={Boolean(form.consentAccepted)} onChange={(e) => setField('consentAccepted', e.target.checked)} />
        <span>I consent to Spotlight using my submitted profile information for application processing and program communication.</span>
      </label>

      <button type="button" className="theme-btn mt-4" onClick={() => void save()}>
        Save Profile
      </button>
    </div>
  );
}
