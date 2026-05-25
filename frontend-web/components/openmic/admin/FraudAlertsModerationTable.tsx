'use client';

import { useMemo, useState } from 'react';

type AlertRow = {
  id: string;
  submissionId: string;
  severity: string;
  reason: string;
  votesInEvent: number;
  createdAt: string;
};

export default function FraudAlertsModerationTable({
  contestId,
  rows,
}: {
  contestId: string;
  rows: AlertRow[];
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);

  async function resolveSelected() {
    if (selectedIds.length === 0) return;
    setLoading(true);
    setMessage('');
    const res = await fetch(`/api/admin/open-mic/contests/${contestId}/moderation-actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-spotlight-role': 'admin' },
      body: JSON.stringify({ action: 'resolve_fraud_alerts', ids: selectedIds }),
    });
    const payload = await res.json().catch(() => ({}));
    setLoading(false);
    setMessage(res.ok && payload?.success ? 'Fraud alerts resolved.' : payload?.error || 'Action failed.');
    if (res.ok && payload?.success) window.location.reload();
  }

  return (
    <div className="overflow-x-auto mt-4 glass-card rounded-md p-3">
      <div className="flex items-center gap-2 mb-2">
        <button type="button" className="btn-outline py-1.5 px-2 text-[11px]" disabled={loading || selectedIds.length === 0} onClick={() => void resolveSelected()}>
          {loading ? 'Updating...' : 'Resolve Selected Alerts'}
        </button>
        {message ? <p className="text-xs text-foreground/70">{message}</p> : null}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-foreground/70">
            <th className="py-2 pr-3">Select</th>
            <th className="py-2 pr-3">When</th>
            <th className="py-2 pr-3">Severity</th>
            <th className="py-2 pr-3">Reason</th>
            <th className="py-2 pr-3">Votes In Event</th>
            <th className="py-2 pr-3">Submission ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td className="py-2 pr-3"><input type="checkbox" checked={selected[row.id] === true} onChange={(e) => setSelected((prev) => ({ ...prev, [row.id]: e.target.checked }))} /></td>
              <td className="py-2 pr-3">{new Date(row.createdAt).toLocaleString()}</td>
              <td className="py-2 pr-3">{row.severity}</td>
              <td className="py-2 pr-3">{row.reason}</td>
              <td className="py-2 pr-3">{row.votesInEvent}</td>
              <td className="py-2 pr-3">{row.submissionId}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="text-foreground/60 mt-2">No suspicious vote spikes detected yet.</p> : null}
    </div>
  );
}
