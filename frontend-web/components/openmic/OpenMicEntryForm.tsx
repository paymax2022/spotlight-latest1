'use client';

import { useState } from 'react';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [downloadMessage, setDownloadMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');

  const [form, setForm] = useState({
    artistName: '',
    email: '',
    genre: 'Afrobeats',
    songTitle: '',
    songUrl: '',
    songDescription: '',
    officialBeatConfirmed: false,
    ownershipConfirmed: false,
    noUnauthorizedSamplesConfirmed: false,
    termsAccepted: false,
    paidAccessConfirmed: !beatRequiresPaidEntry,
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function downloadBeat() {
    setBusy(true);
    setError('');
    setDownloadMessage('');
    setDownloadUrl('');
    try {
      const res = await fetch(`/api/open-mic/contests/${contestSlug}/beat/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistName: form.artistName,
          artistEmail: form.email,
          termsAccepted: form.termsAccepted,
          paidAccessConfirmed: form.paidAccessConfirmed,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Unable to access beat.');
      }
      const beatUrl = String(payload?.beat?.downloadUrl || '');
      setDownloadUrl(beatUrl);
      setDownloadMessage(beatUrl ? 'Beat access approved. Download your official beat below.' : 'Beat access logged successfully. You can now submit your song.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Beat access failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitSong() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/open-mic/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contestSlug,
          stageName: form.artistName,
          email: form.email,
          genre: form.genre,
          songTitle: form.songTitle,
          songUrl: form.songUrl,
          story: form.songDescription,
          cleanVersionAvailable: true,
          officialBeatConfirmed: form.officialBeatConfirmed,
          ownershipConfirmed: form.ownershipConfirmed,
          noUnauthorizedSamplesConfirmed: form.noUnauthorizedSamplesConfirmed,
          finaleAvailabilityConfirmed: true,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Song submission failed.');
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
    <div className="space-y-4 text-foreground">
      <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div className="form-shell">
          <p className="form-section-title">Artist and Song Details</p>
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
              <label className="form-label">Genre*</label>
              <select className="form-input h-[44px]" value={form.genre} onChange={(e) => setField('genre', e.target.value)}>
                <option value="Afrobeats">Afrobeats</option>
                <option value="Afro Pop">Afro Pop</option>
                <option value="Rap/Hip-Hop">Rap/Hip-Hop</option>
                <option value="R&B">R&B</option>
                <option value="Gospel">Gospel</option>
                <option value="Highlife">Highlife</option>
                <option value="Dancehall">Dancehall</option>
                <option value="Street Pop">Street Pop</option>
                <option value="Fuji/Amapiano Fusion">Fuji/Amapiano Fusion</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="form-label">Song Title*</label>
              <input className="form-input h-[44px]" value={form.songTitle} onChange={(e) => setField('songTitle', e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="form-label">Song URL*</label>
              <input className="form-input h-[44px]" value={form.songUrl} onChange={(e) => setField('songUrl', e.target.value)} placeholder="https://..." />
              <p className="form-help">Paste a direct stream or downloadable link to your final song.</p>
            </div>
            <div className="md:col-span-2">
              <label className="form-label">Short Song Description*</label>
              <textarea className="form-input min-h-[110px]" value={form.songDescription} onChange={(e) => setField('songDescription', e.target.value)} />
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
        {beatAvailable ? (
          <button type="button" className="btn-outline py-2.5 px-4 text-xs" onClick={() => void downloadBeat()} disabled={busy}>
            {busy ? 'Processing...' : 'Access / Download Official Beat'}
          </button>
        ) : null}
        <button type="button" className="btn-primary py-2.5 px-4 text-xs" onClick={() => void submitSong()} disabled={busy}>
          {busy ? 'Submitting...' : 'Submit Finished Song'}
        </button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {downloadMessage ? <p className="text-sm text-blue-400">{downloadMessage}</p> : null}
      {downloadUrl ? (
        <p className="text-sm">
          <a className="text-accent-gold underline" href={downloadUrl} target="_blank" rel="noreferrer">
            Download Official Beat
          </a>
        </p>
      ) : null}
      {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
    </div>
  );
}
