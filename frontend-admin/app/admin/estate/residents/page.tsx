'use client';

// A-EST-02 — Residents & units registry. Searchable, with ban/restore (optimistic).

import { useEffect, useMemo, useState } from 'react';
import { listResidents, banResident, restoreResident } from '@/services/estateAdminService';
import type { AdminResident } from '@/types/estateAdmin';
import { PageHeader, EstateTabs, Card, Badge, btn, btnPrimary, th, td, money } from '../_ui';

export default function ResidentsPage() {
  const [rows, setRows] = useState<AdminResident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listResidents()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => `${r.name} ${r.unit} ${r.phone} ${r.role}`.toLowerCase().includes(t));
  }, [rows, q]);

  async function ban(id: string) {
    setBusy(id);
    const prev = rows;
    setRows((r) => r.map((x) => (x.id === id ? { ...x, status: 'banned' } : x))); // optimistic
    try { await banResident(id); }
    catch (e) { setError(String(e)); setRows(prev); }
    finally { setBusy(null); }
  }
  async function restore(id: string) {
    setBusy(id);
    const prev = rows;
    setRows((r) => r.map((x) => (x.id === id ? { ...x, status: 'active' } : x))); // optimistic
    try { await restoreResident(id); }
    catch (e) { setError(String(e)); setRows(prev); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Residents & units" subtitle="Owner / tenant registry per unit. Ban restricts estate access; restore re-enables it." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EstateTabs active="residents" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card right={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, unit, phone…" style={{ ...btn(), cursor: 'text', minWidth: 220 }} />}>
        {loading ? <p style={{ color: '#6b7280' }}>Loading residents…</p> : filtered.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No residents match.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Resident</th><th style={th()}>Unit</th><th style={th()}>Role</th><th style={th()}>Phone</th><th style={th()}>Arrears</th><th style={th()}>Status</th><th style={th()}>Actions</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.name}</strong></td>
                  <td style={td()}>{r.unit}</td>
                  <td style={td()}><Badge status={r.role} /></td>
                  <td style={td()}>{r.phone}</td>
                  <td style={td()}>{r.arrearsKobo > 0 ? <span style={{ color: '#d97706' }}>{money(r.arrearsKobo)}</span> : <span style={{ color: '#16a34a' }}>Clear</span>}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>
                    {r.status === 'banned'
                      ? <button disabled={busy === r.id} onClick={() => restore(r.id)} style={btnPrimary('#16a34a')}>Restore</button>
                      : <button disabled={busy === r.id} onClick={() => ban(r.id)} style={btnPrimary('#dc2626')}>Ban</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
