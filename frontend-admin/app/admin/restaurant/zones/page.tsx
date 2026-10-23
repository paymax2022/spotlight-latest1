'use client';

import { useState } from 'react';
import { listZones, createRadiusZone, deleteZone, CONFIG_PERMS, type DeliveryZone } from '@/services/restaurantConfigAdminService';
import { useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function ZonesPage() {
  const { can } = useRestaurantPermissions();
  const [rid, setRid] = useState('');
  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [km, setKm] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { setZones(await listZones(rid.trim())); setErr(null); } catch (e) { setErr(String(e)); }
  }
  async function add() {
    const bps = Math.round(Number(km) * 100); // radius is stored in hundredths of a km
    if (!(bps > 0)) { setErr('Enter a radius in km greater than 0.'); return; }
    try { await createRadiusZone(rid.trim(), bps); setKm(''); await load(); } catch (e) { setErr(String(e)); }
  }

  if (!can(CONFIG_PERMS.onboarding)) return <Page><AccessNotice perm={CONFIG_PERMS.onboarding[0]} /></Page>;
  return (
    <Page>
      <PageHeader title="Delivery zones" subtitle="Per-restaurant serviceability radius. A restaurant with no zone is not radius-restricted." />
      {err && <div style={{ color: colors.danger, marginBottom: 8 }}>{err}</div>}
      <Card>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input placeholder="Restaurant UUID" value={rid} onChange={(e) => setRid(e.target.value)} />
          <Button variant="primary" onClick={load} disabled={!rid.trim()}>Load zones</Button>
        </div>
      </Card>
      {zones && (
        <Card title="Zones">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Kind', 'Radius', 'Created', ''].map((h) => <th key={h} style={thCell}>{h}</th>)}</tr></thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id}>
                  <td style={tdCell}>{z.kind}</td><td style={tdCell}>{z.radius_km_bps != null ? `${z.radius_km_bps / 100} km` : '—'}</td>
                  <td style={tdCell}>{new Date(z.created_at).toLocaleString()}</td>
                  <td style={tdCell}><Button sm variant="danger" onClick={async () => { await deleteZone(rid.trim(), z.id).catch((e) => setErr(String(e))); await load(); }}>Delete</Button></td>
                </tr>
              ))}
              {zones.length === 0 && <tr><td style={tdCell} colSpan={4}>No zones.</td></tr>}
            </tbody>
          </table>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <Input placeholder="Radius (km)" value={km} onChange={(e) => setKm(e.target.value)} />
            <Button variant="primary" onClick={add}>Add radius zone</Button>
          </div>
        </Card>
      )}
    </Page>
  );
}
