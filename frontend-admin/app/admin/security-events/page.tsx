'use client';

import { useEffect, useMemo, useState } from 'react';
import { listSecurityEvents } from '@/services/auditService';
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
  severity: 'Severity',
  module: 'Module',
  dateFrom: 'From',
  dateTo: 'To',
};

type SortKey = 'created_at' | 'type' | 'module' | 'severity';

const DEFAULTS: AuditFilters = { limit: 500, severity: 'critical,high' };

export default function AdminSecurityEventsPage() {
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [draft, setDraft] = useState<AuditFilters>({ ...DEFAULTS });
  const [applied, setApplied] = useState<AuditFilters>({ ...DEFAULTS });
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'created_at', dir: 'desc' });
  const [page, setPage] = useState(1);
  const { toasts, toast, dismiss } = useToasts();

  const load = async (filters: AuditFilters) => {
    setLoading(true);
    setErrored(false);
    try {
      const data = await listSecurityEvents(filters);
      setRows(data);
      setPage(1);
      if (data.length === 0) toast.info('No security events match the current filters.');
    } catch {
      setErrored(true);
      setRows([]);
      toast.error('Failed to load security events.');
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
    const next: AuditFilters = { ...DEFAULTS };
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
      <h1>Security Events</h1>
      <p>Review high-risk activity and failed login events.</p>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 12 }}>
        <input placeholder="severity" value={draft.severity ?? ''} onChange={(e) => setInput('severity', e.target.value)} />
        <input placeholder="module" value={draft.module ?? ''} onChange={(e) => setInput('module', e.target.value)} />
        <input placeholder="dateFrom (ISO)" value={draft.dateFrom ?? ''} onChange={(e) => setInput('dateFrom', e.target.value)} />
        <input placeholder="dateTo (ISO)" value={draft.dateTo ?? ''} onChange={(e) => setInput('dateTo', e.target.value)} />
        <button onClick={apply}>Apply Filters</button>
      </div>

      <FilterChips chips={chips} onClear={clearChip} onClearAll={clearAll} />

      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 16, fontSize: 13 }}>
        <thead>
          <tr>
            <th style={th()}><SortHeaderButton label="Time" active={sort?.key === 'created_at'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('created_at')} /></th>
            <th style={th()}><SortHeaderButton label="Type" active={sort?.key === 'type'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('type')} /></th>
            <th style={th()}><SortHeaderButton label="Module" active={sort?.key === 'module'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('module')} /></th>
            <th style={th()}><SortHeaderButton label="Severity" active={sort?.key === 'severity'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('severity')} /></th>
            <th style={th()}>User / IP</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td style={td()} colSpan={5}>Loading…</td></tr>
          ) : errored ? (
            <tr><td style={td()} colSpan={5}><button onClick={() => void load(applied)}>Retry</button> — failed to load.</td></tr>
          ) : slice.length === 0 ? (
            <tr><td style={td()} colSpan={5}>No security events to display.</td></tr>
          ) : (
            slice.map((row, idx) => (
              <tr key={String(row.id || idx)}>
                <td style={td()}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(row.created_at || '')}</span></td>
                <td style={td()}><strong>{String(row.type || row.action || '-')}</strong></td>
                <td style={td()}>{String(row.module || '-')}</td>
                <td style={td()}>{String(row.severity || row.status || '-')}</td>
                <td style={td()}><span style={{ fontSize: 12 }}>{String(row.user_id || row.actor_user_id || '-')} · {String(row.ip_address || '-')}</span></td>
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
