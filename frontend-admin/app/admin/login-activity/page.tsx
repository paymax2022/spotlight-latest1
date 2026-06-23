'use client';

import { useEffect, useMemo, useState } from 'react';
import { listLoginActivity } from '@/services/auditService';
import type { AuditFilters, GenericRow } from '@/types/audit';
import {
  useToasts,
  ToastStack,
  FilterChips,
  Pagination,
  usePagination,
  applySort,
  nextSort,
  SortHeaderButton,
  type FilterChip,
  type SortState,
} from '@/components/rbac';

const PAGE_SIZE = 20;

const FILTER_LABELS: Record<string, string> = {
  email: 'Email',
  status: 'Status',
  dateFrom: 'From',
  dateTo: 'To',
};

type SortKey = 'created_at' | 'email' | 'status';

export default function AdminLoginActivityPage() {
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [draft, setDraft] = useState<AuditFilters>({ limit: 500, status: '' });
  const [applied, setApplied] = useState<AuditFilters>({ limit: 500, status: '' });
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'created_at', dir: 'desc' });
  const [page, setPage] = useState(1);
  const { toasts, toast, dismiss } = useToasts();

  const load = async (filters: AuditFilters) => {
    setLoading(true);
    setErrored(false);
    try {
      const data = await listLoginActivity(filters);
      setRows(data);
      setPage(1);
      if (data.length === 0) toast.info('No login activity matches the current filters.');
    } catch {
      setErrored(true);
      setRows([]);
      toast.error('Failed to load login activity.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = () => {
    setApplied(draft);
    void load(draft);
    toast.success('Filters applied.');
  };

  const chips: FilterChip[] = useMemo(() => {
    const out: FilterChip[] = [];
    for (const [k, label] of Object.entries(FILTER_LABELS)) {
      const v = (applied as Record<string, unknown>)[k];
      if (v && String(v).trim()) out.push({ key: k, label, value: String(v) });
    }
    return out;
  }, [applied]);

  const clearChip = (key: string) => {
    const next = { ...applied, [key]: '' };
    setApplied(next);
    setDraft(next);
    void load(next);
  };

  const clearAll = () => {
    const next: AuditFilters = { limit: applied.limit, status: '' };
    setApplied(next);
    setDraft(next);
    void load(next);
  };

  const sorted = useMemo(
    () => applySort(rows, sort, (row, key) => (row as GenericRow)[key]),
    [rows, sort],
  );
  const { slice, total, pageCount, safePage } = usePagination(sorted, PAGE_SIZE, page);

  const setInput = (key: keyof AuditFilters, value: string) => setDraft((f) => ({ ...f, [key]: value }));
  const sortBy = (key: SortKey) => setSort((s) => nextSort(s, key));

  return (
    <div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <h1>Login Activity</h1>
      <p>Track successful and failed login attempts across users.</p>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 12 }}>
        <input placeholder="email" value={draft.email ?? ''} onChange={(e) => setInput('email', e.target.value)} />
        <input placeholder="status (success|failed)" value={draft.status ?? ''} onChange={(e) => setInput('status', e.target.value)} />
        <input placeholder="dateFrom (ISO)" value={draft.dateFrom ?? ''} onChange={(e) => setInput('dateFrom', e.target.value)} />
        <input placeholder="dateTo (ISO)" value={draft.dateTo ?? ''} onChange={(e) => setInput('dateTo', e.target.value)} />
        <button onClick={apply}>Apply Filters</button>
      </div>

      <FilterChips chips={chips} onClear={clearChip} onClearAll={clearAll} />

      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 16, fontSize: 13 }}>
        <thead>
          <tr>
            <th style={th()}><SortHeaderButton label="Time" active={sort?.key === 'created_at'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('created_at')} /></th>
            <th style={th()}><SortHeaderButton label="Email" active={sort?.key === 'email'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('email')} /></th>
            <th style={th()}><SortHeaderButton label="Status" active={sort?.key === 'status'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('status')} /></th>
            <th style={th()}>Failure reason</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td style={td()} colSpan={4}>Loading…</td></tr>
          ) : errored ? (
            <tr><td style={td()} colSpan={4}><button onClick={() => void load(applied)}>Retry</button> — failed to load.</td></tr>
          ) : slice.length === 0 ? (
            <tr><td style={td()} colSpan={4}>No login activity to display.</td></tr>
          ) : (
            slice.map((row, idx) => (
              <tr key={String(row.id || idx)}>
                <td style={td()}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(row.created_at || '')}</span></td>
                <td style={td()}><strong>{String(row.email || '-')}</strong></td>
                <td style={td()}>{String(row.status || '-')}</td>
                <td style={td()}><span style={{ fontSize: 12 }}>{String(row.failure_reason || '-')}</span></td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <Pagination page={safePage} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
    </div>
  );
}

function th(): React.CSSProperties {
  return { textAlign: 'left', borderBottom: '1px solid #2a2a2a', padding: 8 };
}
function td(): React.CSSProperties {
  return { borderBottom: '1px solid #1f1f1f', padding: 8, verticalAlign: 'top' };
}
