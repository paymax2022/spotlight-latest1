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
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <PageHeader
        title="Security Events"
        subtitle="Review high-risk activity and failed login events."
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          <Input placeholder="Severity" value={draft.severity ?? ''} onChange={(e) => setInput('severity', e.target.value)} />
          <Input placeholder="Module" value={draft.module ?? ''} onChange={(e) => setInput('module', e.target.value)} />
          <Input placeholder="Date from (ISO)" value={draft.dateFrom ?? ''} onChange={(e) => setInput('dateFrom', e.target.value)} />
          <Input placeholder="Date to (ISO)" value={draft.dateTo ?? ''} onChange={(e) => setInput('dateTo', e.target.value)} />
        </div>
        <Button variant="primary" style={{ marginTop: 14 }} onClick={apply}>Apply Filters</Button>
      </Card>

      <FilterChips chips={chips} onClear={clearChip} onClearAll={clearAll} />

      <Card style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thCell}><SortHeaderButton label="Time" active={sort?.key === 'created_at'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('created_at')} /></th>
              <th style={thCell}><SortHeaderButton label="Type" active={sort?.key === 'type'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('type')} /></th>
              <th style={thCell}><SortHeaderButton label="Module" active={sort?.key === 'module'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('module')} /></th>
              <th style={thCell}><SortHeaderButton label="Severity" active={sort?.key === 'severity'} dir={sort?.dir ?? 'asc'} onClick={() => sortBy('severity')} /></th>
              <th style={thCell}>User / IP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={5}>Loading…</td></tr>
            ) : errored ? (
              <tr><td style={tdCell} colSpan={5}><Button variant="outline" sm onClick={() => void load(applied)}>Retry</Button> <span style={{ color: colors.danger }}>— failed to load.</span></td></tr>
            ) : slice.length === 0 ? (
              <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={5}>No security events to display.</td></tr>
            ) : (
              slice.map((row, idx) => {
                const severity = String(row.severity || row.status || '-');
                return (
                  <tr key={String(row.id || idx)}>
                    <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 12, color: colors.muted }}>{String(row.created_at || '')}</td>
                    <td style={tdCell}><strong>{String(row.type || row.action || '-')}</strong></td>
                    <td style={{ ...tdCell, color: colors.muted }}>{String(row.module || '-')}</td>
                    <td style={tdCell}>{severity === '-' ? <span style={{ color: colors.muted }}>—</span> : <Badge text={severity} color={severityColor(severity)} />}</td>
                    <td style={{ ...tdCell, fontSize: 12, color: colors.muted }}>{String(row.user_id || row.actor_user_id || '-')} · {String(row.ip_address || '-')}</td>
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

function severityColor(severity: string): string {
  const s = severity.toLowerCase();
  if (s === 'critical' || s === 'high') return colors.danger;
  if (s === 'medium' || s === 'warning') return colors.warning;
  if (s === 'low' || s === 'info') return colors.info;
  return colors.secondary;
}
