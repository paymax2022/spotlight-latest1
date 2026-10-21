'use client';

import { useCallback, useEffect, useState } from 'react';
import { listConsents, CONFIG_PERMS, type ConsentRow } from '@/services/restaurantConfigAdminService';
import { useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

// Read-only audit of the append-only user_consents ledger (newest first).
export default function ConsentsPage() {
  const { can } = useRestaurantPermissions();
  const [rows, setRows] = useState<ConsentRow[]>([]);
  const [kind, setKind] = useState('');
  const [userId, setUserId] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listConsents({ kind: kind.trim(), user_id: userId.trim(), limit: 100 })); setErr(null); } catch (e) { setErr(String(e)); }
  }, [kind, userId]);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!can(CONFIG_PERMS.onboarding)) return <Page><AccessNotice perm={CONFIG_PERMS.onboarding[0]} /></Page>;
  return (
    <Page>
      <PageHeader title="Consent audit" subtitle="Marketing / promo consent grants and withdrawals. IPs are stored hashed and never shown." />
      {err && <div style={{ color: colors.danger, marginBottom: 8 }}>{err}</div>}
      <Card>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input placeholder="Kind (marketing, promo…)" value={kind} onChange={(e) => setKind(e.target.value)} />
          <Input placeholder="User UUID" value={userId} onChange={(e) => setUserId(e.target.value)} />
          <Button variant="primary" onClick={load}>Filter</Button>
        </div>
      </Card>
      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['When', 'User', 'Kind', 'Status', 'Source'].map((h) => <th key={h} style={thCell}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={tdCell}>{new Date(r.created_at).toLocaleString()}</td><td style={tdCell}><code>{r.user_id}</code></td>
                <td style={tdCell}>{r.kind}</td>
                <td style={tdCell}><Badge text={r.status} color={r.status === 'granted' ? colors.success : colors.secondary} /></td>
                <td style={tdCell}>{r.source ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={tdCell} colSpan={5}>No consent records.</td></tr>}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
