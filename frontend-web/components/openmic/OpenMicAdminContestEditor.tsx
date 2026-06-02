'use client';

import { useState } from 'react';
import type { OpenMicContest, OpenMicContestStatus } from '@/src/features/openmic/types';

type Props = {
  contest: OpenMicContest;
};

const STATUS_OPTIONS: OpenMicContestStatus[] = [
  'draft',
  'scheduled',
  'published',
  'registration_open',
  'beat_available',
  'submission_open',
  'submission_closed',
  'under_review',
  'voting_live',
  'voting_closed',
  'finalists_selected',
  'winner_announced',
  'completed',
  'archived',
  'suspended',
  'cancelled',
];

export default function OpenMicAdminContestEditor({ contest }: Props) {
  const [busy, setBusy] = useState(false);
  const [uploadingBeat, setUploadingBeat] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [form, setForm] = useState({
    title: contest.title || '',
    description: contest.description || '',
    status: contest.status || 'draft',
    registrationFeeNgn: Number(contest.registrationFeeNgn || 0),
    entryFeeRequired: Boolean(contest.entryFeeRequired),
    venueName: contest.finale?.venueName || '',
    venueType: contest.finale?.venueType || 'lounge',
    address: contest.finale?.address || '',
    city: contest.finale?.city || '',
    state: contest.finale?.state || '',
    beatTitle: contest.beat?.beatTitle || '',
    producerName: contest.beat?.producerName || '',
    downloadUrl: contest.beat?.downloadUrl || '',
    previewUrl: contest.beat?.previewUrl || '',
    usageRules: contest.beat?.usageRules || 'Beat is provided for this Spotlight Open Mic contest only.',
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function uploadBeatFile(file: File) {
    setUploadingBeat(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/registration/uploads', { method: 'POST', body });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Beat upload failed.');
      const uploadedUrl = String(payload?.upload?.previewUrl || '');
      if (!uploadedUrl) throw new Error('Upload succeeded but no file URL was returned.');
      setForm((prev) => ({
        ...prev,
        downloadUrl: uploadedUrl,
        previewUrl: prev.previewUrl || uploadedUrl,
      }));
      setMessage('Beat file uploaded. Save changes to publish it.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Beat upload failed.');
    } finally {
      setUploadingBeat(false);
    }
  }

  async function saveContest() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const contestRes = await fetch(`/api/admin/open-mic/contests/${contest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-spotlight-role': 'admin' },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          status: form.status,
          registrationFeeNgn: Number(form.registrationFeeNgn || 0),
          entryFeeRequired: Boolean(form.entryFeeRequired),
          finale: {
            ...contest.finale,
            venueName: form.venueName,
            venueType: form.venueType,
            address: form.address,
            city: form.city,
            state: form.state,
          },
        }),
      });
      const contestPayload = await contestRes.json().catch(() => ({}));
      if (!contestRes.ok || !contestPayload?.success) {
        throw new Error(contestPayload?.error || 'Failed to save contest changes.');
      }

      if (form.beatTitle.trim() && form.downloadUrl.trim()) {
        const beatRes = await fetch(`/api/admin/open-mic/contests/${contest.id}/beats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-spotlight-role': 'admin' },
          body: JSON.stringify({
            beatTitle: form.beatTitle,
            producerName: form.producerName || 'Spotlight Producer',
            producerCredit: form.producerName || 'Spotlight Producer',
            downloadUrl: form.downloadUrl,
            previewUrl: form.previewUrl || form.downloadUrl,
            usageRules: form.usageRules,
            allowDownload: true,
            previewOnly: false,
            requiresPaidEntryForDownload: form.entryFeeRequired,
            cleanVersionRequired: true,
            explicitLyricsAllowed: false,
          }),
        });
        const beatPayload = await beatRes.json().catch(() => ({}));
        if (!beatRes.ok || !beatPayload?.success) {
          throw new Error(beatPayload?.error || 'Contest updated but beat update failed.');
        }
      }

      setMessage('Contest and beat settings saved successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="form-shell">
        <p className="form-section-title">Contest Management</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="form-label">Contest Title</label>
            <input className="form-input h-[44px]" value={form.title} onChange={(e) => setField('title', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Status</label>
            <select
              className="form-input h-[44px]"
              value={form.status}
              onChange={(e) => setField('status', e.target.value as OpenMicContestStatus)}
            >
              {STATUS_OPTIONS.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Description</label>
            <textarea className="form-input min-h-[100px]" value={form.description} onChange={(e) => setField('description', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Registration Fee (NGN)</label>
            <input
              className="form-input h-[44px]"
              type="number"
              value={form.registrationFeeNgn}
              onChange={(e) => setField('registrationFeeNgn', Number(e.target.value || 0))}
            />
          </div>
          <div className="flex items-end">
            <label className="form-check-row">
              <input type="checkbox" checked={form.entryFeeRequired} onChange={(e) => setField('entryFeeRequired', e.target.checked)} />
              <span>Require paid entry for beat access</span>
            </label>
          </div>
        </div>
      </div>

      <div className="form-shell">
        <p className="form-section-title">Beat (MP3) Management</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="form-label">Beat Title</label>
            <input className="form-input h-[44px]" value={form.beatTitle} onChange={(e) => setField('beatTitle', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Producer Name</label>
            <input className="form-input h-[44px]" value={form.producerName} onChange={(e) => setField('producerName', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Beat Download URL (used by frontend download button)</label>
            <input className="form-input h-[44px]" value={form.downloadUrl} onChange={(e) => setField('downloadUrl', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Upload Beat File (MP3/WAV)</label>
            <input
              className="form-input h-[44px]"
              type="file"
              accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/mp4"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) void uploadBeatFile(selected);
              }}
              disabled={uploadingBeat}
            />
            <p className="form-help">{uploadingBeat ? 'Uploading beat...' : 'Upload auto-fills the download URL.'}</p>
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Beat Usage Rules</label>
            <textarea className="form-input min-h-[90px]" value={form.usageRules} onChange={(e) => setField('usageRules', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="form-shell">
        <p className="form-section-title">Finale Venue</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="form-label">Venue Name</label>
            <input className="form-input h-[44px]" value={form.venueName} onChange={(e) => setField('venueName', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Venue Type</label>
            <input className="form-input h-[44px]" value={form.venueType} onChange={(e) => setField('venueType', e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Address</label>
            <input className="form-input h-[44px]" value={form.address} onChange={(e) => setField('address', e.target.value)} />
          </div>
          <div>
            <label className="form-label">City</label>
            <input className="form-input h-[44px]" value={form.city} onChange={(e) => setField('city', e.target.value)} />
          </div>
          <div>
            <label className="form-label">State</label>
            <input className="form-input h-[44px]" value={form.state} onChange={(e) => setField('state', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="pt-1">
        <button type="button" className="btn-primary py-3 px-5 text-[11px]" onClick={() => void saveContest()} disabled={busy}>
          {busy ? 'Saving...' : 'Save Contest Changes'}
        </button>
      </div>

      {error ? <p className="text-sm text-red-400 font-semibold">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-400 font-semibold">{message}</p> : null}
    </div>
  );
}
