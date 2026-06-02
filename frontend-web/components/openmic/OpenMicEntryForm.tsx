'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getOpenMicLgaOptions, OPEN_MIC_COUNTRIES, OPEN_MIC_STATES } from '@/src/features/openmic/location-options';

type Props = {
  contestSlug: string;
  contestTitle: string;
  beatAvailable: boolean;
  beatRequiresPaidEntry: boolean;
};

export default function OpenMicEntryForm({
  contestSlug,
  contestTitle,
  beatAvailable,
  beatRequiresPaidEntry,
}: Props) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [downloadMessage, setDownloadMessage] = useState('');
  const [uploadingSong, setUploadingSong] = useState(false);
  const [songUploadMessage, setSongUploadMessage] = useState('');

  const [form, setForm] = useState({
    artistName: '',
    email: '',
    country: 'Nigeria',
    state: '',
    lga: '',
    instagramHandle: '',
    tiktokHandle: '',
    youtubeHandle: '',
    facebookHandle: '',
    xHandle: '',
    songUrl: '',
    submissionId: '',
    songObjectKey: '',
    songFileName: '',
    officialBeatConfirmed: false,
    ownershipConfirmed: false,
    noUnauthorizedSamplesConfirmed: false,
    termsAccepted: false,
    paidAccessConfirmed: !beatRequiresPaidEntry,
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'state' ? { lga: '' } : {}),
    }));
  }

  const lgaOptions = getOpenMicLgaOptions(form.state);

  // Pre-fill name + email from the Supabase session on first render.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      if (!u) return;
      const name =
        u.user_metadata?.full_name ||
        u.user_metadata?.name ||
        u.email?.split('@')[0] ||
        '';
      setForm((prev) => ({
        ...prev,
        artistName: prev.artistName || name,
        email: prev.email || u.email || '',
      }));
    });
  // supabase client is stable; this only needs to run once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function guessFileName(url: string) {
    try {
      const { pathname } = new URL(url);
      const raw = pathname.split('/').pop() || '';
      if (raw.toLowerCase().endsWith('.mp3')) return raw;
    } catch {
      // fall through to default filename
    }
    return `${contestSlug}-official-beat.mp3`;
  }

  function triggerFileDownload(url: string) {
    const link = document.createElement('a');
    link.href = url;
    link.download = guessFileName(url);
    link.target = '_blank';
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function downloadBeat() {
    setBusy(true);
    setError('');
    setDownloadMessage('');
    try {
      const beatUrl = `/api/open-mic/contests/${contestSlug}/beat/download`;
      triggerFileDownload(beatUrl);
      setDownloadMessage('Your official beat download has started. Complete the form after recording your song.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Beat access failed.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!beatAvailable) return;
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#beat-step') return;
    void downloadBeat();
  }, [beatAvailable]);

  async function uploadSongFile(file: File) {
    setUploadingSong(true);
    setError('');
    setSongUploadMessage('');
    try {
      if (!file.name.toLowerCase().endsWith('.mp3')) {
        throw new Error('Please upload an MP3 file.');
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Please sign in to upload your song.');

      const contentType = 'audio/mp3';
      const presignRes = await fetch('/api/open-mic/uploads/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          contestSlug,
          fileName: file.name,
          fileSize: file.size,
          contentType,
        }),
      });
      const presignPayload = await presignRes.json().catch(() => ({}));
      if (!presignRes.ok || !presignPayload?.success) {
        throw new Error(presignPayload?.error || 'Unable to prepare song upload.');
      }

      const uploadUrl = String(presignPayload.upload?.uploadUrl || '');
      const objectKey = String(presignPayload.upload?.objectKey || '');
      const submissionId = String(presignPayload.upload?.submissionId || '');
      if (!uploadUrl || !objectKey || !submissionId) throw new Error('Upload URL was not returned.');

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('Direct upload to storage failed.');

      const completeRes = await fetch('/api/open-mic/uploads/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          contestSlug,
          submissionId,
          objectKey,
          fileName: file.name,
        }),
      });
      const completePayload = await completeRes.json().catch(() => ({}));
      if (!completeRes.ok || !completePayload?.success) {
        throw new Error(completePayload?.error || 'Unable to confirm song upload.');
      }

      setField('submissionId', submissionId);
      setField('songObjectKey', objectKey);
      setField('songFileName', file.name);
      setField('songUrl', '');
      setSongUploadMessage('MP3 uploaded successfully. You can now submit your finished song.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Song upload failed.');
    } finally {
      setUploadingSong(false);
    }
  }

  async function submitSong() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!form.songObjectKey && !form.songUrl.trim()) {
        throw new Error('Upload your completed MP3 before submitting.');
      }
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Please sign in to submit your song.');
      const res = await fetch('/api/open-mic/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          contestSlug,
          stageName: form.artistName,
          email: form.email,
          country: form.country.trim(),
          state: form.state.trim(),
          lga: form.lga.trim(),
          instagramHandle: form.instagramHandle.trim(),
          tiktokHandle: form.tiktokHandle.trim(),
          youtubeHandle: form.youtubeHandle.trim(),
          facebookHandle: form.facebookHandle.trim(),
          xHandle: form.xHandle.trim(),
          songUrl: form.songUrl,
          submissionId: form.submissionId,
          songObjectKey: form.songObjectKey,
          songFileName: form.songFileName,
          cleanVersionAvailable: true,
          officialBeatConfirmed: form.officialBeatConfirmed,
          ownershipConfirmed: form.ownershipConfirmed,
          noUnauthorizedSamplesConfirmed: form.noUnauthorizedSamplesConfirmed,
          finaleAvailabilityConfirmed: true,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        const validationMessage = payload?.errors && typeof payload.errors === 'object'
          ? Object.values(payload.errors).join(' ')
          : '';
        throw new Error(payload?.error || validationMessage || 'Song submission failed.');
      }
      setMessage(
        `Your submission for ${contestTitle} is received and under review. Share link will be available after approval.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" style={{ color: '#111827' }}>
      {beatAvailable ? (
        <div className="form-shell border border-accent-gold/40 bg-accent-gold/10">
          <p className="form-section-title">Step 1: Download Official Beat</p>
          <p className="form-help mb-3">
            Download the official beat first, record your completed song, then return here to upload and submit.
          </p>
          <button
            id="download-beat-action"
            type="button"
            className="btn-outline py-2.5 px-4 text-xs"
            onClick={() => void downloadBeat()}
            disabled={busy}
          >
            {busy ? 'Processing...' : 'Access / Download Official Beat'}
          </button>
        </div>
      ) : null}

      <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div className="form-shell">
          <p className="form-section-title">Step 2: Artist and Song Details</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="form-label">Stage Name*</label>
              <input className="form-input h-[44px]" value={form.artistName} onChange={(e) => setField('artistName', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Email Address*</label>
              <input className="form-input h-[44px]" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
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
              <label className="form-label">Completed Song MP3*</label>
              <input
                className="form-input h-[44px]"
                type="file"
                accept="audio/mp3,.mp3"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (selected) void uploadSongFile(selected);
                }}
                disabled={uploadingSong}
              />
              <p className="form-help">
                {uploadingSong
                  ? 'Uploading MP3 directly to secure storage...'
                  : form.songFileName
                    ? `Uploaded: ${form.songFileName}`
                    : 'Upload your finished song as an MP3 file.'}
              </p>
              <label className="form-label mt-2">Fallback Song URL</label>
              <input className="form-input h-[44px]" value={form.songUrl} onChange={(e) => setField('songUrl', e.target.value)} placeholder="https://..." />
              <p className="form-help">Use this only if direct MP3 upload is not available.</p>
            </div>
          </div>
        </div>

        <div className="form-shell space-y-2">
          <p className="form-section-title">Submission Declarations</p>
          <label className="form-check-row"><input type="checkbox" checked={form.termsAccepted} onChange={(e) => setField('termsAccepted', e.target.checked)} /> <span>I accept beat usage rules.</span></label>
          {beatRequiresPaidEntry ? (
            <label className="form-check-row"><input type="checkbox" checked={form.paidAccessConfirmed} onChange={(e) => setField('paidAccessConfirmed', e.target.checked)} /> <span>I confirm registration payment/access has been completed.</span></label>
          ) : null}
          <label className="form-check-row"><input type="checkbox" checked={form.officialBeatConfirmed} onChange={(e) => setField('officialBeatConfirmed', e.target.checked)} /> <span>I used the official beat.</span></label>
          <label className="form-check-row"><input type="checkbox" checked={form.ownershipConfirmed} onChange={(e) => setField('ownershipConfirmed', e.target.checked)} /> <span>I own my lyrics/vocals rights.</span></label>
          <label className="form-check-row"><input type="checkbox" checked={form.noUnauthorizedSamplesConfirmed} onChange={(e) => setField('noUnauthorizedSamplesConfirmed', e.target.checked)} /> <span>No unauthorized samples were used in this submission.</span></label>
        </div>
      </form>

      <div className="pt-1 flex gap-2 flex-wrap">
        <button
          type="button"
          className="btn-primary py-2.5 px-4 text-xs"
          onClick={() => void submitSong()}
          disabled={busy || uploadingSong}
        >
          {busy ? 'Submitting...' : uploadingSong ? 'Uploading Song...' : 'Submit Finished Song'}
        </button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {downloadMessage ? <p className="text-sm text-blue-400">{downloadMessage}</p> : null}
      {songUploadMessage ? <p className="text-sm text-emerald-400">{songUploadMessage}</p> : null}
      {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
    </div>
  );
}
