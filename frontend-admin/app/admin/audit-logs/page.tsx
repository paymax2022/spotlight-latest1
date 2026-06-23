'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildAuditExportUrl, listAuditLogs } from '@/services/auditService';
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
  module: 'Module',
  action: 'Action',
  severity: 'Severity',
  actorUser: 'Actor',
  dateFrom: 'From',
  dateTo: 'To',
};

type SortKey = 'created_at' | 'action' | 'module' | 'severity';

export default function AdminAuditLogsPage() {
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [draft, setDraft] = useState<AuditFilters>({ limit: 500, severity: '' });
  const [applied, setApplied] = useState<AuditFilters>({ limit: 500, severity: '' });
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'created_at', dir: 'desc' });
  const [page, setPage] = useState(1);
  const { toasts, toast, dismiss } = useToasts();

  const load = async (filters: AuditFilters) => {
    setLoading(true);
    setErrored(false);
    try {
      const data = await listAuditLogs(filters);
      setRows(data);
      setPage(1);
      if (data.length === 0) toast.info('No audit logs match the current filters.');
    } catch {
      setErrored(true);
      setRows([]);
      toast.error('Failed to load audit logs. Check your permissions and try again.');
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
    const next: AuditFilters = { limit: applied.limit, severity: '' };
    setApplied(next);
    setDraft(next);
    void load(next);
  };

  const sorted = useMemo(
    () => applySort(rows, sort, (row, key) => (row as GenericRow)[key]),
    [rows, sort],
  );
  const { slice, total, pageCount, safePage } = usePagination(sorted, PAGE_SIZE, page);
  const exportUrl = useMemo(() => buildAuditExportUrl(applied), [applied]);

  const setInput = (key: keyof AuditFilters, value: string) => setDraft((f) => ({ ...f, [key]: value }));
  const sortBy = (key: SortKey) => setSort((s) => nextSort(s, key));

  return (
    <div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <h1>Audit Logs</h1>
      <p>Filter and inspect sensitive admin actions with export support.</p>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 12 }}>
        <input placeholder="module" value={draft.module ?? ''} onChange={(e) => setInput('module', e.target.value)} />
        <input placeholder="action" value={draft.action ?? ''} onChange={(e) => setInput('action', e.target.value)} />
        <input placeholder="severity (critical,high)" value={draft.severity ?? ''} onChange={(e) => setInput('severity', e.target.value)} />
        <input placeholder="actor user id" value={draft.actorUser ?? ''} onChange={(e) => setInput('actorUser', e.target.value)} />
        <input placeholder="dateFrom (ISO)" value={draft.dateFrom ?? ''} onChange={(e) => setInput('dateFrom', e.target.value)} />
        <input placeholder="dateTo (ISO)" value={draft.dateTo ?? ''} onChange={(e) => setInput('dateTo', e.target.value)} />
        <button onClick={apply}>Apply Filters</button>
        <a href={exportUrl} target="_blank" rel="noreferrer">Export JSON</a>
      </div>

      <FilterChips chips={chips} onClear={clearChip} onClearAll={clearAll} />

      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 16, fontSize: 13 }}>
        <thead>
          <tr>
            <th style={th()}><SortHeaderButton label="Time" active={sort?.key === 'created_at'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('created_at')} /></th>
            <th style={th()}><SortHeaderButton label="Action" active={sort?.key === 'action'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('action')} /></th>
            <th style={th()}><SortHeaderButton label="Module" active={sort?.key === 'module'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('module')} /></th>
            <th style={th()}><SortHeaderButton label="Severity" active={sort?.key === 'severity'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('severity')} /></th>
            <th style={th()}>Actor / Target</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td style={td()} colSpan={5}>Loading…</td></tr>
          ) : errored ? (
            <tr><td style={td()} colSpan={5}><button onClick={() => void load(applied)}>Retry</button> — failed to load.</td></tr>
          ) : slice.length === 0 ? (
            <tr><td style={td()} colSpan={5}>No audit logs to display.</td></tr>
          ) : (
            slice.map((row, idx) => (
              <tr key={String(row.id || idx)}>
                <td style={td()}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(row.created_at || '')}</span></td>
                <td style={td()}><strong>{String(row.action || '-')}</strong></td>
                <td style={td()}>{String(row.module || '-')}</td>
                <td style={td()}>{String(row.severity || '-')}</td>
                <td style={td()}><span style={{ fontSize: 12 }}>{String(row.actor_user_id || '-')} → {String(row.target_user_id || '-')}</span></td>
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
