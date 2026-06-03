'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { adminAuthHeaders } from '@/src/lib/auth/client';

type OpenMicContest = {
  id: string;
  title: string;
  slug: string;
  month: number;
  year: number;
  status: string;
  visibility: string;
  registrationFeeNgn: number;
  entryFeeRequired: boolean;
};

const STATUS_OPTIONS = [
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

function badgeClass(status: string) {
  const value = status.toLowerCase();
  if (value.includes('published') || value.includes('live') || value.includes('open') || value.includes('completed')) return 'badge-approved';
  if (value.includes('suspended') || value.includes('cancelled') || value.includes('rejected') || value.includes('failed')) return 'badge-rejected';
  return 'badge-pending';
}

export default function OpenMicContestManager() {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [contests, setContests] = useState<OpenMicContest[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/open-mic/contests?page=1&pageSize=100', {
        headers: await adminAuthHeaders(),
        cache: 'no-store',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to load contests.');
      }
      const rows = (payload.contests || []) as OpenMicContest[];
      setContests(rows);
      setSelectedStatus(rows.reduce<Record<string, string>>((acc, c) => {
        acc[c.id] = c.status;
        return acc;
      }, {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const sorted = useMemo(
    () => [...contests].sort((a, b) => (a.year === b.year ? b.month - a.month : b.year - a.year)),
    [contests]
  );

  async function saveStatus(contestId: string) {
    setSavingId(contestId);
    setError('');
    setMessage('');
    try {
      const nextStatus = selectedStatus[contestId];
      const res = await fetch(`/api/admin/open-mic/contests/${contestId}`, {
        method: 'PATCH',
        headers: await adminAuthHeaders(true),
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        if (res.status === 404 || String(payload?.error || '').toLowerCase().includes('not found')) {
          setError('This contest record is no longer available. Refreshing list...');
          await load();
          return;
        }
        throw new Error(payload?.error || 'Failed to update contest status.');
      }
      setMessage('Contest status updated successfully.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update contest status.');
    } finally {
      setSavingId('');
    }
  }

  if (loading) {
    return <p className="text-foreground-muted">Loading contests...</p>;
  }

  return (
    <div>
      {error ? <p className="text-red-400 text-sm font-semibold mb-3">{error}</p> : null}
      {message ? <p className="text-emerald-400 text-sm font-semibold mb-3">{message}</p> : null}

      <div className="overflow-x-auto border border-border rounded-sm">
        <table className="w-full min-w-[980px] text-sm data-table">
          <thead className="bg-bg-card">
            <tr>
              <th>Contest</th>
              <th>Edition</th>
              <th>Status</th>
              <th>Visibility</th>
              <th>Registration</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((contest) => (
              <tr key={contest.id} className="border-t border-border">
                <td>
                  <div className="font-semibold text-foreground">{contest.title}</div>
                  <div className="text-xs text-foreground-dim">/{contest.slug}</div>
                </td>
                <td>{contest.month}/{contest.year}</td>
                <td>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(contest.status)}`}>
                    {contest.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="capitalize">{contest.visibility.replace(/_/g, ' ')}</td>
                <td>
                  {contest.entryFeeRequired
                    ? `Paid (NGN ${Number(contest.registrationFeeNgn || 0).toLocaleString('en-NG')})`
                    : 'Free'}
                </td>
                <td>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      className="form-input h-[40px] py-1.5 px-2"
                      value={selectedStatus[contest.id] || contest.status}
                      onChange={(e) => setSelectedStatus((prev) => ({ ...prev, [contest.id]: e.target.value }))}
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-outline py-1.5 px-2 text-[10px]"
                      onClick={() => void saveStatus(contest.id)}
                      disabled={savingId === contest.id}
                    >
                      {savingId === contest.id ? 'Saving...' : 'Save'}
                    </button>
                    <Link href={`/admin/open-mic/${contest.id}/edit`} className="btn-primary py-1.5 px-2 text-[10px]">
                      Edit
                    </Link>
                    <Link href={`/admin/open-mic/${contest.id}/applications`} className="btn-outline py-1.5 px-2 text-[10px]">
                      Applicants
                    </Link>
                    <Link href={`/admin/open-mic/${contest.id}/submissions`} className="btn-outline py-1.5 px-2 text-[10px]">
                      Submissions
                    </Link>
                    <Link href={`/admin/open-mic/${contest.id}/votes`} className="btn-outline py-1.5 px-2 text-[10px]">
                      Votes
                    </Link>
                    <Link href={`/admin/open-mic/${contest.id}/finalists`} className="btn-outline py-1.5 px-2 text-[10px]">
                      Finalists
                    </Link>
                    <Link href={`/admin/open-mic/${contest.id}/finale`} className="btn-outline py-1.5 px-2 text-[10px]">
                      Finale
                    </Link>
                    <Link href={`/admin/open-mic/${contest.id}/winners`} className="btn-outline py-1.5 px-2 text-[10px]">
                      Winners
                    </Link>
                    <Link href={`/admin/open-mic/${contest.id}/reports`} className="btn-outline py-1.5 px-2 text-[10px]">
                      Reports
                    </Link>
                    <Link href={`/admin/open-mic/${contest.id}/payments`} className="btn-outline py-1.5 px-2 text-[10px]">
                      Payments
                    </Link>
                    <Link href={`/admin/open-mic/${contest.id}/notifications`} className="btn-outline py-1.5 px-2 text-[10px]">
                      Notifications
                    </Link>
                    <Link href={`/admin/open-mic/${contest.id}/fraud-alerts`} className="btn-outline py-1.5 px-2 text-[10px]">
                      Fraud Alerts
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
