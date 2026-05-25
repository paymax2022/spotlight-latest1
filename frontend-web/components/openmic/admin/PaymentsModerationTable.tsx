'use client';

import { useMemo, useState } from 'react';

type PaymentRow = {
  id: string;
  eventType: string;
  amountNgn: number;
  paymentStatus: string;
  paymentReference?: string;
  createdAt: string;
};

export default function PaymentsModerationTable({
  contestId,
  rows,
}: {
  contestId: string;
  rows: PaymentRow[];
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState('refunded');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);

  async function updateStatus() {
    if (selectedIds.length === 0) return;
    setLoading(true);
    setMessage('');
    const res = await fetch(`/api/admin/open-mic/contests/${contestId}/moderation-actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-spotlight-role': 'admin' },
      body: JSON.stringify({ action: 'update_payment_status', ids: selectedIds, paymentStatus: status }),
    });
    const payload = await res.json().catch(() => ({}));
    setLoading(false);
    setMessage(res.ok && payload?.success ? 'Payment statuses updated.' : payload?.error || 'Action failed.');
    if (res.ok && payload?.success) window.location.reload();
  }

  return (
    <div className="overflow-x-auto mt-4 glass-card rounded-md p-3">
      <div className="flex items-center gap-2 mb-2">
        <select className="form-input h-[36px] py-1.5 px-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="successful">Successful</option>
          <option value="failed">Failed</option>
          <option value="refunded">Refunded</option>
          <option value="waived">Waived</option>
        </select>
        <button type="button" className="btn-outline py-1.5 px-2 text-[11px]" disabled={loading || selectedIds.length === 0} onClick={() => void updateStatus()}>
          {loading ? 'Updating...' : 'Update Selected'}
        </button>
        {message ? <p className="text-xs text-foreground/70">{message}</p> : null}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-foreground/70">
            <th className="py-2 pr-3">Select</th>
            <th className="py-2 pr-3">When</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Amount</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Reference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td className="py-2 pr-3"><input type="checkbox" checked={selected[row.id] === true} onChange={(e) => setSelected((prev) => ({ ...prev, [row.id]: e.target.checked }))} /></td>
              <td className="py-2 pr-3">{new Date(row.createdAt).toLocaleString()}</td>
              <td className="py-2 pr-3">{row.eventType.replace(/_/g, ' ')}</td>
              <td className="py-2 pr-3">₦{row.amountNgn}</td>
              <td className="py-2 pr-3">{row.paymentStatus}</td>
              <td className="py-2 pr-3">{row.paymentReference || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="text-foreground/60 mt-2">No payment events yet.</p> : null}
    </div>
  );
}
