'use client';

import { useMemo, useState } from 'react';
import { NIGERIA_CITIES_BY_STATE, NIGERIA_STATES } from '@/src/features/registration/config';

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export default function OpenMicAdminContestBuilder() {
  const [busy, setBusy] = useState(false);
  const [uploadingBeat, setUploadingBeat] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [createdId, setCreatedId] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    title: '',
    slug: '',
    description: '',
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    season: `Season ${new Date().getFullYear()}`,
    status: 'draft',
    registrationFeeNgn: 0,
    entryFeeRequired: false,
    repeatMonths: 1,
    autoCreateNext: false,
    requireNewBeatEveryMonth: true,
    finalistsTarget: 10,
    judgeWeight: 30,
    publicVoteWeight: 70,
    venueName: '',
    venueType: 'lounge',
    address: '',
    city: '',
    state: '',
    beatTitle: '',
    beatProducerName: '',
    beatDownloadUrl: '',
    beatPreviewUrl: '',
    beatUsageRules: 'Beat is provided for this Spotlight Open Mic contest only.',
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'title' && !slugTouched) {
        next.slug = slugify(String(value || ''));
      }
      if (key === 'state') {
        next.city = '';
      }
      return next;
    });
  }

  const cityOptions = useMemo(() => {
    return NIGERIA_CITIES_BY_STATE[form.state] || [];
  }, [form.state]);

  function validateForm() {
    const errors: Record<string, string> = {};
    if (!String(form.title || '').trim()) errors.title = 'Contest title is required.';
    if (!String(form.slug || '').trim()) errors.slug = 'Contest slug is required.';
    if (!String(form.description || '').trim()) errors.description = 'Contest description is required.';
    if (!form.month || form.month < 1 || form.month > 12) errors.month = 'Month must be between 1 and 12.';
    if (!form.year || form.year < 2020) errors.year = 'Year must be valid.';
    if (form.judgeWeight + form.publicVoteWeight !== 100) {
      errors.weights = 'Judge weight and public vote weight must add up to 100%.';
    }
    if (!String(form.state || '').trim()) errors.state = 'State is required.';
    if (!String(form.city || '').trim()) errors.city = 'City is required.';
    if (!String(form.venueName || '').trim()) errors.venueName = 'Finale venue name is required.';
    if (!String(form.beatTitle || '').trim()) errors.beatTitle = 'Official beat title is required.';
    if (!String(form.beatDownloadUrl || '').trim()) errors.beatDownloadUrl = 'Official beat file URL is required.';
    return errors;
  }

  async function uploadBeatFile(file: File) {
    setUploadingBeat(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/registration/uploads', {
        method: 'POST',
        body,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Beat upload failed.');
      }
      const uploadedUrl = payload?.upload?.previewUrl;
      if (uploadedUrl) {
        setForm((prev) => ({
          ...prev,
          beatDownloadUrl: uploadedUrl,
          beatPreviewUrl: prev.beatPreviewUrl || uploadedUrl,
        }));
      }
      setMessage('Beat file uploaded and attached to this contest.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Beat upload failed.');
    } finally {
      setUploadingBeat(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError('');
    setMessage('');
    setCreatedId('');
    setValidationErrors({});
    const localErrors = validateForm();
    if (Object.keys(localErrors).length > 0) {
      setValidationErrors(localErrors);
      setError('Please fix the highlighted fields.');
      setBusy(false);
      return;
    }
    try {
      const res = await fetch('/api/admin/open-mic/contests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-spotlight-role': 'admin',
        },
        body: JSON.stringify({
          title: form.title,
          slug: form.slug,
          description: form.description,
          month: form.month,
          year: form.year,
          season: form.season,
          status: form.status,
          registrationFeeNgn: form.registrationFeeNgn,
          entryFeeRequired: form.entryFeeRequired,
          recurrence: {
            enabled: form.repeatMonths > 1 || form.autoCreateNext,
            repeatMonths: form.repeatMonths,
            autoCreateNext: form.autoCreateNext,
            autoCopySettings: true,
            autoPublishFuture: false,
            requireNewBeatEveryMonth: form.requireNewBeatEveryMonth,
          },
          beat: {
            beatTitle: form.beatTitle,
            producerName: form.beatProducerName || 'Spotlight Producer',
            producerCredit: form.beatProducerName || 'Spotlight Producer',
            downloadUrl: form.beatDownloadUrl,
            previewUrl: form.beatPreviewUrl || form.beatDownloadUrl,
            usageRules: form.beatUsageRules,
            allowDownload: true,
            previewOnly: false,
            requiresPaidEntryForDownload: form.entryFeeRequired,
            cleanVersionRequired: true,
            explicitLyricsAllowed: false,
          },
          finalistsTarget: form.finalistsTarget,
          judgeWeight: form.judgeWeight,
          publicVoteWeight: form.publicVoteWeight,
          finale: {
            venueName: form.venueName,
            venueType: form.venueType,
            address: form.address,
            city: form.city,
            state: form.state,
            playbackMode: 'top_10',
          },
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        const serverErrors = payload?.errors && typeof payload.errors === 'object' ? payload.errors : {};
        setValidationErrors(serverErrors);
        const messageText =
          Object.values(serverErrors as Record<string, string>).join(' ') ||
          payload?.error ||
          'Failed to create contest.';
        throw new Error(messageText);
      }
      setCreatedId(payload?.contest?.id || '');
      setMessage('Monthly Open Mic contest created successfully.');
      setForm((prev) => ({
        ...prev,
        title: '',
        slug: '',
        description: '',
        beatTitle: '',
        beatProducerName: '',
        beatDownloadUrl: '',
        beatPreviewUrl: '',
      }));
      setSlugTouched(false);
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          window.location.href = '/admin/open-mic';
        }, 700);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create contest.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="form-shell">
        <p className="form-section-title">Contest Identity</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="form-label">Contest Title*</label>
          <input className="form-input h-[44px]" value={form.title} onChange={(e) => setField('title', e.target.value)} />
          {validationErrors.title ? <p className="form-error">{validationErrors.title}</p> : null}
        </div>
        <div>
          <label className="form-label">Contest Slug*</label>
          <input
            className="form-input h-[44px]"
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              setField('slug', slugify(e.target.value));
            }}
          />
          {validationErrors.slug ? <p className="form-error">{validationErrors.slug}</p> : null}
        </div>
        <div className="md:col-span-2">
          <label className="form-label">Description*</label>
          <textarea className="form-input min-h-[110px]" value={form.description} onChange={(e) => setField('description', e.target.value)} />
          {validationErrors.description ? <p className="form-error">{validationErrors.description}</p> : null}
        </div>
        </div>
      </div>

      <div className="form-shell">
        <p className="form-section-title">Edition and Status</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="form-label">Month*</label>
          <input className="form-input h-[44px]" type="number" value={form.month} onChange={(e) => setField('month', Number(e.target.value))} />
          {validationErrors.month ? <p className="form-error">{validationErrors.month}</p> : null}
        </div>
        <div>
          <label className="form-label">Year*</label>
          <input className="form-input h-[44px]" type="number" value={form.year} onChange={(e) => setField('year', Number(e.target.value))} />
          {validationErrors.year ? <p className="form-error">{validationErrors.year}</p> : null}
        </div>
        <div>
          <label className="form-label">Season</label>
          <input className="form-input h-[44px]" value={form.season} onChange={(e) => setField('season', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Status</label>
          <select className="form-input h-[44px]" value={form.status} onChange={(e) => setField('status', e.target.value)}>
            <option value="draft">draft</option>
            <option value="scheduled">scheduled</option>
            <option value="published">published</option>
            <option value="registration_open">registration_open</option>
          </select>
        </div>
        </div>
      </div>

      <div className="form-shell">
        <p className="form-section-title">Economics and Scoring</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="form-label">Registration Fee (NGN)</label>
          <input className="form-input h-[44px]" type="number" value={form.registrationFeeNgn} onChange={(e) => setField('registrationFeeNgn', Number(e.target.value))} />
        </div>
        <div>
          <label className="form-label">Repeat Months</label>
          <input className="form-input h-[44px]" type="number" value={form.repeatMonths} onChange={(e) => setField('repeatMonths', Number(e.target.value))} />
        </div>

        <div>
          <label className="form-label">Finalists Target</label>
          <input className="form-input h-[44px]" type="number" value={form.finalistsTarget} onChange={(e) => setField('finalistsTarget', Number(e.target.value))} />
        </div>
        <div>
          <label className="form-label">Judge Weight (%)</label>
          <input className="form-input h-[44px]" type="number" value={form.judgeWeight} onChange={(e) => setField('judgeWeight', Number(e.target.value))} />
        </div>
        <div>
          <label className="form-label">Public Vote Weight (%)</label>
          <input className="form-input h-[44px]" type="number" value={form.publicVoteWeight} onChange={(e) => setField('publicVoteWeight', Number(e.target.value))} />
          {validationErrors.weights ? <p className="form-error">{validationErrors.weights}</p> : null}
        </div>
        </div>
      </div>

      <div className="form-shell">
        <p className="form-section-title">Official Beat Upload</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="form-label">Official Beat Title*</label>
            <input className="form-input h-[44px]" value={form.beatTitle} onChange={(e) => setField('beatTitle', e.target.value)} />
            {validationErrors.beatTitle ? <p className="form-error">{validationErrors.beatTitle}</p> : null}
          </div>
          <div>
            <label className="form-label">Producer Name</label>
            <input className="form-input h-[44px]" value={form.beatProducerName} onChange={(e) => setField('beatProducerName', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Beat File URL (Download)*</label>
            <input className="form-input h-[44px]" value={form.beatDownloadUrl} onChange={(e) => setField('beatDownloadUrl', e.target.value)} placeholder="https://..." />
            <p className="form-help">You can paste a direct URL, or upload an MP3/WAV file below.</p>
            {validationErrors.beatDownloadUrl ? <p className="form-error">{validationErrors.beatDownloadUrl}</p> : null}
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Upload Beat File (MP3/WAV)</label>
            <input
              className="form-input h-[44px] file:mr-3 file:rounded-sm file:border file:border-white/60 file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-foreground"
              type="file"
              accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/mp4"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) void uploadBeatFile(selected);
              }}
              disabled={uploadingBeat}
            />
            <p className="form-help">{uploadingBeat ? 'Uploading beat file...' : 'After upload, the beat URL will be auto-filled.'}</p>
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Beat Preview URL (Optional)</label>
            <input className="form-input h-[44px]" value={form.beatPreviewUrl} onChange={(e) => setField('beatPreviewUrl', e.target.value)} placeholder="https://..." />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Beat Usage Rules</label>
            <textarea className="form-input min-h-[96px]" value={form.beatUsageRules} onChange={(e) => setField('beatUsageRules', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="form-shell">
        <p className="form-section-title">Finale Venue</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="form-label">Finale Venue Name</label>
          <input className="form-input h-[44px]" value={form.venueName} onChange={(e) => setField('venueName', e.target.value)} />
          {validationErrors.venueName ? <p className="form-error">{validationErrors.venueName}</p> : null}
        </div>
        <div>
          <label className="form-label">Venue Type</label>
          <select className="form-input h-[44px]" value={form.venueType} onChange={(e) => setField('venueType', e.target.value)}>
            <option value="lounge">Lounge</option>
            <option value="club">Club</option>
            <option value="event_center">Event Center</option>
            <option value="campus_venue">Campus Venue</option>
            <option value="virtual">Virtual</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="form-label">Address</label>
          <input className="form-input h-[44px]" value={form.address} onChange={(e) => setField('address', e.target.value)} />
        </div>
        <div>
          <label className="form-label">State</label>
          <select className="form-input h-[44px]" value={form.state} onChange={(e) => setField('state', e.target.value)}>
            <option value="">Select state</option>
            {NIGERIA_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
          {validationErrors.state ? <p className="form-error">{validationErrors.state}</p> : null}
        </div>
        <div>
          <label className="form-label">City</label>
          <select className="form-input h-[44px]" value={form.city} onChange={(e) => setField('city', e.target.value)} disabled={!form.state}>
            <option value="">{form.state ? 'Select city' : 'Select state first'}</option>
            {cityOptions.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          {validationErrors.city ? <p className="form-error">{validationErrors.city}</p> : null}
        </div>
        </div>
      </div>

      <div className="form-shell space-y-2">
        <p className="form-section-title">Automation Settings</p>
        <label className="form-check-row"><input type="checkbox" checked={form.entryFeeRequired} onChange={(e) => setField('entryFeeRequired', e.target.checked)} /> Paid registration required</label>
        <label className="form-check-row"><input type="checkbox" checked={form.autoCreateNext} onChange={(e) => setField('autoCreateNext', e.target.checked)} /> Auto-create next monthly edition</label>
        <label className="form-check-row"><input type="checkbox" checked={form.requireNewBeatEveryMonth} onChange={(e) => setField('requireNewBeatEveryMonth', e.target.checked)} /> Require new beat every month</label>
      </div>

      <div className="mt-5">
        <button type="button" className="btn-primary py-3 px-5 text-[11px]" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Creating...' : 'Create Monthly Contest'}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-red-400 font-semibold">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-emerald-400 font-semibold">{message}</p> : null}
      {createdId ? <p className="mt-2 text-sm text-accent-gold">Contest ID: {createdId}</p> : null}
    </div>
  );
}
