'use client';

import { useEffect, useMemo, useState } from 'react';

type Submission = {
  id: string;
  contestId: string;
  stageName: string;
  songTitle: string;
  genre: string;
  country?: string;
  state?: string;
  lga?: string;
  instagramHandle?: string;
  tiktokHandle?: string;
  youtubeHandle?: string;
  facebookHandle?: string;
  xHandle?: string;
  status: string;
  voteCount: number;
  songUrl: string;
  songObjectKey?: string;
};

const reviewStatuses = [
  'approved',
  'rejected',
  'correction_requested',
  'clean_version_requested',
  'published_for_voting',
  'disqualified',
  'finalist',
  'winner',
] as const;

export default function OpenMicAdminSubmissionReview() {
  const badgeClass = (status: string) => {
    const value = status.toLowerCase();
    if (value.includes('approved') || value.includes('published') || value.includes('winner')) return 'badge-approved';
    if (value.includes('rejected') || value.includes('disqualified')) return 'badge-rejected';
    return 'badge-pending';
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<Record<string, string>>({});
  const [selectedNote, setSelectedNote] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/open-mic/submissions', {
        headers: { 'x-spotlight-role': 'admin' },
        cache: 'no-store',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to load submissions.');
      const rows = (payload.submissions || []) as Submission[];
      setSubmissions(rows);
      setSelectedStatus(
        rows.reduce<Record<string, string>>((acc, item) => {
          acc[item.id] = 'approved';
          return acc;
        }, {})
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load submissions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function runReview(submissionId: string) {
    setMessage('');
    setError('');
    try {
      const res = await fetch(`/api/admin/open-mic/submissions/${submissionId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-spotlight-role': 'admin' },
        body: JSON.stringify({
          status: selectedStatus[submissionId],
          note: selectedNote[submissionId] || '',
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Review action failed.');
      setMessage('Review action completed.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review action failed.');
    }
  }

  async function openSong(submissionId: string, download = false) {
    setMessage('');
    setError('');
    try {
      const res = await fetch(`/api/admin/open-mic/submissions/${submissionId}/song${download ? '?download=1' : ''}`, {
        headers: { 'x-spotlight-role': 'admin' },
        cache: 'no-store',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success || !payload?.signedUrl) {
        throw new Error(payload?.error || 'Unable to create song access URL.');
      }
      window.open(String(payload.signedUrl), '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open song.');
    }
  }

  const grouped = useMemo(() => {
    return submissions.reduce<Record<string, Submission[]>>((acc, item) => {
      const key = item.status;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [submissions]);

  if (loading) return <p className="text-foreground-muted">Loading Open Mic submissions...</p>;

  return (
    <div>
      {error ? <p className="text-red-400 font-semibold mb-3">{error}</p> : null}
      {message ? <p className="text-emerald-400 font-semibold mb-3">{message}</p> : null}

      {Object.entries(grouped).map(([status, rows]) => (
        <div key={status} className="mb-4 glass-card rounded-md p-4">
          <h4 className="font-display text-foreground capitalize mb-3">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(status)}`}>
              {status.replaceAll('_', ' ')}
            </span>
          </h4>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {rows.map((item) => (
              <div key={item.id} className="border border-border rounded-sm p-3 bg-bg-card">
                <h5 className="text-foreground font-semibold">{item.songTitle}</h5>
                <p className="mb-1 text-sm text-foreground-muted">{item.stageName} • {item.genre}</p>
                <p className="mb-1 text-sm text-foreground-muted">
                  {[item.lga, item.state, item.country].filter(Boolean).join(', ') || 'Location not provided'}
                </p>
                <p className="mb-2 text-xs text-foreground-muted">
                  {[
                    item.instagramHandle ? `IG: ${item.instagramHandle}` : '',
                    item.tiktokHandle ? `TikTok: ${item.tiktokHandle}` : '',
                    item.youtubeHandle ? `YouTube: ${item.youtubeHandle}` : '',
                    item.facebookHandle ? `Facebook: ${item.facebookHandle}` : '',
                    item.xHandle ? `X: ${item.xHandle}` : '',
                  ].filter(Boolean).join(' | ') || 'No social handle provided'}
                </p>
                <p className="mb-2 text-sm text-foreground-muted">
                  Votes: {item.voteCount} •{' '}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(item.status)}`}>
                    {item.status.replaceAll('_', ' ')}
                  </span>
                </p>
                <div className="mb-3 d-flex flex-wrap gap-2">
                  <button type="button" className="btn-outline py-2 px-3 text-[11px]" onClick={() => void openSong(item.id)}>
                    Stream Song
                  </button>
                  <button type="button" className="btn-outline py-2 px-3 text-[11px]" onClick={() => void openSong(item.id, true)}>
                    Download Song
                  </button>
                </div>

                <label className="form-label">Review Decision</label>
                <select
                  className="form-input h-[42px] mb-2"
                  value={selectedStatus[item.id] || 'approved'}
                  onChange={(e) => setSelectedStatus((prev) => ({ ...prev, [item.id]: e.target.value }))}
                >
                  {reviewStatuses.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
                <label className="form-label">Admin Note</label>
                <input
                  className="form-input h-[42px] mb-3"
                  placeholder="Review note (optional)"
                  value={selectedNote[item.id] || ''}
                  onChange={(e) => setSelectedNote((prev) => ({ ...prev, [item.id]: e.target.value }))}
                />
                <button type="button" className="btn-primary py-2.5 px-4 text-[11px]" onClick={() => void runReview(item.id)}>
                  Apply Review Action
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
