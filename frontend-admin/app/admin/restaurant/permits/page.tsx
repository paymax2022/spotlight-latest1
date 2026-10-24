'use client';

import { useCallback, useEffect, useState } from 'react';
import { listPermits, setPermit, backfillNullPermits, CONFIG_PERMS, type PermitRow, type PermitFilter } from '@/services/restaurantConfigAdminService';
import { useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const FILTERS: PermitFilter[] = ['all', 'missing', 'expired', 'expiring'];

export default function PermitsPage() {
  const { can } = useRestaurantPermissions();
  const [filter, setFilter] = useState<PermitFilter>('missing');
  const [rows, setRows] = useState<PermitRow[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [bulk, setBulk] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listPermits(filter)); setErr(null); } catch (e) { setErr(String(e)); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const iso = (d: string) => new Date(`${d}T23:59:59Z`).toISOString();
  async function save() {
    if (!editId || !date) return;
    try { await setPermit(editId, iso(date)); setEditId(null); setDate(''); await load(); } catch (e) { setErr(String(e)); }
  }
  async function runBackfill() {
    if (!bulk || !window.confirm(`Stamp ${bulk} as the permit expiry on EVERY open restaurant that has none?`)) return;
    try {
      const r = await backfillNullPermits(iso(bulk));
      setMsg(`Stamped ${r.updated} restaurant(s)${r.truncated ? ` (hit the ${r.ceiling}-row ceiling — run again)` : ''}.`);
      await load();
    } catch (e) { setErr(String(e)); }
  }

  if (!can(CONFIG_PERMS.onboarding)) return <Page><AccessNotice perm={CONFIG_PERMS.onboarding[0]} /></Page>;
  return (
    <Page>
      <PageHeader title="Permit expiry" subtitle="A store can only be opened while its business permit is unexpired. Expired permits close the store automatically." />
      {err && <div style={{ color: colors.danger, marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ color: colors.success, marginBottom: 8 }}>{msg}</div>}
      <Card title="One-shot backfill (rollout)">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Input type="date" value={bulk} onChange={(e) => setBulk(e.target.value)} />
          <Button variant="danger" onClick={runBackfill} disabled={!bulk}>Stamp open restaurants with no permit</Button>
        </div>
      </Card>
      <Card right={<div style={{ display: 'flex', gap: 4 }}>{FILTERS.map((f) => <Button key={f} sm variant={f === filter ? 'primary' : 'outline'} onClick={() => setFilter(f)}>{f}</Button>)}</div>}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Restaurant', 'Open', 'Permit expires', 'Hold', ''].map((h) => <th key={h} style={thCell}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.restaurant_id}>
                <td style={tdCell}>{r.name}</td>
                <td style={tdCell}><Badge text={r.is_open ? 'open' : 'closed'} color={r.is_open ? colors.success : colors.secondary} /></td>
                <td style={tdCell}>{r.permit_expires_at ? new Date(r.permit_expires_at).toLocaleDateString() : <Badge text="none on file" color={colors.warning} />}</td>
                <td style={tdCell}>{r.compliance_hold_reason ?? '—'}</td>
                <td style={tdCell}>
                  {editId === r.restaurant_id ? (
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                      <Button sm variant="primary" onClick={save}>Save</Button><Button sm onClick={() => setEditId(null)}>Cancel</Button>
                    </span>
                  ) : <Button sm onClick={() => setEditId(r.restaurant_id)}>Set expiry</Button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={tdCell} colSpan={5}>Nothing in this view.</td></tr>}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
