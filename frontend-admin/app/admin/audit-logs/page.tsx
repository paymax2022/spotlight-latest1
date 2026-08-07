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
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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

function severityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical':
    case 'high':
      return colors.danger;
    case 'medium':
      return colors.warning;
    case 'low':
    case 'info':
      return colors.info;
    default:
      return colors.secondary;
  }
}

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
    <Page>
      <ToastStack toasts={toasts} onDismiss={dismiss} />

      <PageHeader
        title="Audit Logs"
        subtitle="Filter and inspect sensitive admin actions with export support."
      />

      <Card title="Filters" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 14 }}>
          <Input placeholder="Module" value={draft.module ?? ''} onChange={(e) => setInput('module', e.target.value)} />
          <Input placeholder="Action" value={draft.action ?? ''} onChange={(e) => setInput('action', e.target.value)} />
          <Input placeholder="Severity (critical,high)" value={draft.severity ?? ''} onChange={(e) => setInput('severity', e.target.value)} />
          <Input placeholder="Actor user id" value={draft.actorUser ?? ''} onChange={(e) => setInput('actorUser', e.target.value)} />
          <Input placeholder="From (ISO)" value={draft.dateFrom ?? ''} onChange={(e) => setInput('dateFrom', e.target.value)} />
          <Input placeholder="To (ISO)" value={draft.dateTo ?? ''} onChange={(e) => setInput('dateTo', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button variant="primary" onClick={apply}>Apply Filters</Button>
          <a className="vx-btn vx-btn--outline" href={exportUrl} target="_blank" rel="noreferrer">Export JSON</a>
        </div>
      </Card>

      <FilterChips chips={chips} onClear={clearChip} onClearAll={clearAll} />

      <Card style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thCell}><SortHeaderButton label="Time" active={sort?.key === 'created_at'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('created_at')} /></th>
              <th style={thCell}><SortHeaderButton label="Action" active={sort?.key === 'action'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('action')} /></th>
              <th style={thCell}><SortHeaderButton label="Module" active={sort?.key === 'module'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('module')} /></th>
              <th style={thCell}><SortHeaderButton label="Severity" active={sort?.key === 'severity'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('severity')} /></th>
              <th style={thCell}>Actor / Target</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={5}>Loading…</td></tr>
            ) : errored ? (
              <tr><td style={tdCell} colSpan={5}><Button variant="outline" sm onClick={() => void load(applied)}>Retry</Button> <span style={{ color: colors.danger }}>— failed to load.</span></td></tr>
            ) : slice.length === 0 ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={5}>No audit logs to display.</td></tr>
            ) : (
              slice.map((row, idx) => {
                const severity = String(row.severity || '');
                return (
                  <tr key={String(row.id || idx)}>
                    <td style={tdCell}><span style={{ fontFamily: 'monospace', fontSize: 12, color: colors.muted }}>{String(row.created_at || '')}</span></td>
                    <td style={tdCell}><strong>{String(row.action || '-')}</strong></td>
                    <td style={{ ...tdCell, color: colors.muted }}>{String(row.module || '-')}</td>
                    <td style={tdCell}>{severity ? <Badge text={severity} color={severityColor(severity)} /> : <span style={{ color: colors.muted }}>-</span>}</td>
                    <td style={{ ...tdCell, color: colors.muted }}><span style={{ fontSize: 12 }}>{String(row.actor_user_id || '-')} → {String(row.target_user_id || '-')}</span></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div style={{ padding: '10px 14px' }}>
          <Pagination page={safePage} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
        </div>
      </Card>
    </Page>
  );
}
