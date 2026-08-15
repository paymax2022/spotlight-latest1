'use client';

// A-EST-02 — Residents & units registry. Searchable, with ban/restore (optimistic).

import { useEffect, useMemo, useState } from 'react';
import { listResidents, banResident, restoreResident } from '@/services/estateAdminService';
import type { AdminResident } from '@/types/estateAdmin';
import { EstateTabs, money } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
function statusColor(status: string): string {
  if (status === 'active' || status === 'owner') return status === 'owner' ? colors.info : colors.success;
  if (status === 'banned') return colors.danger;
  if (status === 'tenant') return colors.secondary;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Residents & units" subtitle="Owner / tenant registry per unit. Ban restricts estate access; restore re-enables it." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <EstateTabs active="residents" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card title="Residents">
        <div style={{ marginBottom: '0.75rem' }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, unit, phone…" style={{ minWidth: 220 }} />
        </div>
        {loading ? <p style={{ color: colors.muted }}>Loading residents…</p> : filtered.length === 0 ? (
          <p style={{ color: colors.muted }}>No residents match.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Resident</th><th style={thCell}>Unit</th><th style={thCell}>Role</th><th style={thCell}>Phone</th><th style={thCell}>Arrears</th><th style={thCell}>Status</th><th style={thCell}>Actions</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><strong>{r.name}</strong></td>
                  <td style={tdCell}>{r.unit}</td>
                  <td style={tdCell}><Badge text={cap(r.role)} color={statusColor(r.role)} /></td>
                  <td style={tdCell}>{r.phone}</td>
                  <td style={tdCell}>{r.arrearsKobo > 0 ? <span style={{ color: colors.warning }}>{money(r.arrearsKobo)}</span> : <span style={{ color: colors.success }}>Clear</span>}</td>
                  <td style={tdCell}><Badge text={cap(r.status)} color={statusColor(r.status)} /></td>
                  <td style={tdCell}>
                    {r.status === 'banned'
                      ? <Button variant="primary" sm disabled={busy === r.id} onClick={() => restore(r.id)}>Restore</Button>
                      : <Button variant="danger" sm disabled={busy === r.id} onClick={() => ban(r.id)}>Ban</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
