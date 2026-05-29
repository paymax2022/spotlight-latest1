'use client';

import { useEffect, useState } from 'react';
import { listSecurityEvents } from '@/services/auditService';
import type { AuditFilters, GenericRow } from '@/types/audit';

export default function AdminSecurityEventsPage() {
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AuditFilters>({ limit: 100, severity: 'critical,high' });

  const load = async () => {
    setLoading(true);
    setRows(await listSecurityEvents(filters));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <h1>Security Events</h1>
      <p>Review high-risk activity and failed login events.</p>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 12 }}>
        <input placeholder="severity" defaultValue="critical,high" onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))} />
        <input placeholder="module" onChange={(e) => setFilters((f) => ({ ...f, module: e.target.value }))} />
        <input placeholder="dateFrom (ISO)" onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
        <input placeholder="dateTo (ISO)" onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
        <button onClick={() => void load()}>Apply Filters</button>
      </div>
      {loading ? <p>Loading...</p> : null}
      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        {rows.map((row, idx) => (
          <article key={String(row.id || idx)} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{String(row.created_at || '')}</p>
            <p style={{ margin: '6px 0 0 0' }}><strong>{String(row.type || row.action || '-')}</strong> · {String(row.module || '-')} · {String(row.severity || row.status || '-')}</p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>User: {String(row.user_id || row.actor_user_id || '-')} · IP: {String(row.ip_address || '-')}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
