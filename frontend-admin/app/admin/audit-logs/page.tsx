'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildAuditExportUrl, listAuditLogs } from '@/services/auditService';
import type { AuditFilters, GenericRow } from '@/types/audit';

export default function AdminAuditLogsPage() {
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AuditFilters>({ limit: 100, severity: '' });

  const load = async () => {
    setLoading(true);
    setRows(await listAuditLogs(filters));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const exportUrl = useMemo(() => buildAuditExportUrl(filters), [filters]);

  return (
    <div>
      <h1>Audit Logs</h1>
      <p>Filter and inspect sensitive admin actions with export support.</p>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 12 }}>
        <input placeholder="module" onChange={(e) => setFilters((f) => ({ ...f, module: e.target.value }))} />
        <input placeholder="action" onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} />
        <input placeholder="severity (critical,high)" onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))} />
        <input placeholder="actor user id" onChange={(e) => setFilters((f) => ({ ...f, actorUser: e.target.value }))} />
        <input placeholder="dateFrom (ISO)" onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
        <input placeholder="dateTo (ISO)" onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
        <button onClick={() => void load()}>Apply Filters</button>
        <a href={exportUrl} target="_blank" rel="noreferrer">Export JSON</a>
      </div>
      {loading ? <p>Loading...</p> : null}
      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        {rows.map((row, idx) => (
          <article key={String(row.id || idx)} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{String(row.created_at || '')}</p>
            <p style={{ margin: '6px 0 0 0' }}><strong>{String(row.action || '-')}</strong> · {String(row.module || '-')} · {String(row.severity || '-')}</p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>Actor: {String(row.actor_user_id || '-')} · Target: {String(row.target_user_id || '-')}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
