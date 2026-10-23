'use client';

import { useCallback, useEffect, useState } from 'react';
import { listCommission, putCommission, deleteCommission, CONFIG_PERMS, type CommissionRow } from '@/services/restaurantConfigAdminService';
import { useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export default function CommissionPage() {
  const { can } = useRestaurantPermissions();
  const allowed = can(CONFIG_PERMS.commission);
  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ restaurant_id: string; p: string; r: string; f: string } | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listCommission()); setErr(null); } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!edit) return;
    const [p, r, f] = [edit.p, edit.r, edit.f].map((v) => Math.round(Number(v) * 100));
    if (p + r + f !== 10000) { setErr('Provider + rider + platform must total 100%.'); return; }
    try {
      await putCommission({ restaurant_id: edit.restaurant_id.trim() || undefined, provider_split_bps: p, rider_split_bps: r, platform_split_bps: f });
      setEdit(null); await load();
    } catch (e) { setErr(String(e)); }
  }

  if (!allowed) return <Page><AccessNotice perm={CONFIG_PERMS.commission[0]} /></Page>;
  return (
    <Page>
      <PageHeader title="Commission split" subtitle="Global default and per-restaurant overrides (provider / rider / platform). Changes are audited server-side."
        actions={<Button variant="primary" onClick={() => setEdit({ restaurant_id: '', p: '80', r: '10', f: '10' })}>New / update split</Button>} />
      {err && <div style={{ color: colors.danger, marginBottom: 8 }}>{err}</div>}
      {edit && (
        <Card title="Set split (percent)">
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
            <Input placeholder="Restaurant UUID (blank = global)" value={edit.restaurant_id} onChange={(e) => setEdit({ ...edit, restaurant_id: e.target.value })} />
            <Input placeholder="Provider %" value={edit.p} onChange={(e) => setEdit({ ...edit, p: e.target.value })} />
            <Input placeholder="Rider %" value={edit.r} onChange={(e) => setEdit({ ...edit, r: e.target.value })} />
            <Input placeholder="Platform %" value={edit.f} onChange={(e) => setEdit({ ...edit, f: e.target.value })} />
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <Button variant="primary" onClick={save}>Save</Button>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </Card>
      )}
      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Scope', 'Provider', 'Rider', 'Platform', 'Effective', ''].map((h) => <th key={h} style={thCell}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.restaurant_id ?? 'global'}-${r.created_at}`}>
                <td style={tdCell}>{r.restaurant_id ? <code>{r.restaurant_id}</code> : <Badge text="Global default" />}</td>
                <td style={tdCell}>{pct(r.provider_split_bps)}</td><td style={tdCell}>{pct(r.rider_split_bps)}</td><td style={tdCell}>{pct(r.platform_split_bps)}</td>
                <td style={tdCell}>{new Date(r.effective_from).toLocaleString()}</td>
                <td style={tdCell}>
                  <Button sm onClick={() => setEdit({ restaurant_id: r.restaurant_id ?? '', p: String(r.provider_split_bps / 100), r: String(r.rider_split_bps / 100), f: String(r.platform_split_bps / 100) })}>Edit</Button>{' '}
                  {r.restaurant_id && <Button sm variant="danger" onClick={async () => { await deleteCommission(r.restaurant_id!).catch((e) => setErr(String(e))); await load(); }}>Remove override</Button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={tdCell} colSpan={6}>No rows — the built-in 80/10/10 applies.</td></tr>}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
