'use client';

import { useEffect, useState } from 'react';
import { listLoginActivity } from '@/services/auditService';
import type { AuditFilters, GenericRow } from '@/types/audit';

export default function AdminLoginActivityPage() {
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AuditFilters>({ limit: 100, status: '' });

  const load = async () => {
    setLoading(true);
    setRows(await listLoginActivity(filters));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <h1>Login Activity</h1>
      <p>Track successful and failed login attempts across users.</p>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 12 }}>
        <input placeholder="email" onChange={(e) => setFilters((f) => ({ ...f, email: e.target.value }))} />
        <input placeholder="status (success|failed)" onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} />
        <input placeholder="dateFrom (ISO)" onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
        <input placeholder="dateTo (ISO)" onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
        <button onClick={() => void load()}>Apply Filters</button>
      </div>
      {loading ? <p>Loading...</p> : null}
      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        {rows.map((row, idx) => (
          <article key={String(row.id || idx)} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>{String(row.created_at || '')}</p>
            <p style={{ margin: '6px 0 0 0' }}><strong>{String(row.email || '-')}</strong> · {String(row.status || '-')}</p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>Failure: {String(row.failure_reason || '-')}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
