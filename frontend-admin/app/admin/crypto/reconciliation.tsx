'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchReconciliation, type ReconciliationReport } from '@/lib/api';
import ReconTable from './ReconTable';

const REFRESH_MS = 30_000;

// <input type="datetime-local"> value (local time, minute precision).
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Card({ id, label, value, className }: { id: string; label: string; value?: number; className: string }) {
  return (
    <div data-testid={`card-${id}`} className={`rounded border p-4 ${className}`}>
      <div className="text-sm text-gray-600">{label}</div>
      <div className="text-2xl font-semibold">{value ?? '-'}</div>
    </div>
  );
}

export default function ReconciliationPage() {
  const [start, setStart] = useState(() => toLocalInput(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [end, setEnd] = useState(() => toLocalInput(new Date()));
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = new Date(start);
    const e = new Date(end);
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchReconciliation({
        details: true,
        start_date: Number.isNaN(s.getTime()) ? undefined : s.toISOString(),
        end_date: Number.isNaN(e.getTime()) ? undefined : e.toISOString(),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Crypto swap reconciliation</h1>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          Start Date
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
            className="ml-2 rounded border px-2 py-1" />
        </label>
        <label className="text-sm">
          End Date
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)}
            className="ml-2 rounded border px-2 py-1" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh (30s)
        </label>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="rounded border px-3 py-1 text-sm">Refresh</button>
      </div>

      {error && <p role="alert" className="text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card id="total" label="Total Orders" value={report?.total_orders} className="bg-white" />
        <Card id="reconcilled" label="Reconcilled" value={report?.reconcilled_orders} className="bg-green-50" />
        <Card id="drift" label="Drift" value={report?.drift_orders} className="bg-orange-50" />
        <Card id="failed" label="Failed" value={report?.failed_orders} className="bg-red-50" />
      </div>
      {report && <p className="text-xs text-gray-500">{report.summary} (run {new Date(report.run_at).toLocaleString()})</p>}

      <ReconTable orders={report?.orders ?? []} />
    </div>
  );
}
