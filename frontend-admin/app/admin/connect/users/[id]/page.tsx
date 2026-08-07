'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getConnectUser, formatNaira } from '@/services/connectAdminService';
import type { ConnectUserDetail } from '@/types/connectAdmin';
import { PageHeader, Card, Badge, th, td } from '../../_ui';
import { Page, colors } from '@/components/ui/vuexy';

export default function ConnectUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [u, setU] = useState<ConnectUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() { setLoading(true); setError(null); try { setU(await getConnectUser(id)); } catch (e) { setError(String(e)); } finally { setLoading(false); } }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (loading) return <Page><p style={{ color: colors.muted }}>Loading…</p></Page>;
  if (error || !u) return <Page><p style={{ color: colors.danger }}>{error ?? 'Not found'}</p><Link href="/admin/connect/users" style={{ color: colors.info }}>← Back</Link></Page>;

  return (
    <Page>
      <Link href="/admin/connect/users" style={{ color: colors.info, textDecoration: 'none', fontSize: '0.85rem' }}>← Users</Link>
      <div style={{ height: 8 }} />
      <PageHeader title={`${u.display_name} ${u.handle}`} subtitle={`Tier ${u.tier} · ${u.region} · ${u.modes.join(', ')}`} />

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Badge status={u.status === 'active' ? 'resolved' : u.status === 'banned' || u.status === 'suspended' ? 'critical' : 'high'} label={u.status} />
        <Badge status={u.verification === 'full' ? 'resolved' : 'normal'} label={`Verify: ${u.verification}`} />
        {u.flags.map((f) => <Badge key={f} status="high" label={f} />)}
        {u.open_cases > 0 ? <Badge status="open" label={`${u.open_cases} open case(s)`} /> : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <Card title="Profile (PII masked)">
          <KV k="Email" v={u.email_masked} />
          <KV k="Phone" v={u.phone_masked} />
          <KV k="Region" v={u.region} />
          <KV k="Modes" v={u.modes.join(', ')} />
          <KV k="Wallet balance" v={formatNaira(u.wallet_balance_kobo)} />
          <KV k="Gifts sent (lifetime)" v={formatNaira(u.lifetime_gift_sent_kobo)} />
          <KV k="Gifts received (lifetime)" v={formatNaira(u.lifetime_gift_received_kobo)} />
        </Card>

        <Card title="KYC / Tier status">
          <KV k="Current tier" v={`Tier ${u.tier}`} />
          <KV k="BVN" v={u.bvn_status} cap />
          <KV k="NIN" v={u.nin_status} cap />
          <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: colors.muted, fontWeight: 600 }}>Tier change history</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.35rem' }}>
            <tbody>
              {u.tier_history.map((t) => (
                <tr key={t.id}><td style={td()}>T{t.from_tier} → T{t.to_tier}</td><td style={td()}>{t.reason}</td><td style={{ ...td(), color: colors.muted }}>{new Date(t.created_at).toLocaleDateString('en-NG')}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Devices">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th()}>Device</th><th style={th()}>Trusted</th><th style={th()}>Last seen</th></tr></thead>
          <tbody>
            {u.devices.map((d) => (
              <tr key={d.id}><td style={td()}>{d.label}</td><td style={td()}><Badge status={d.trusted ? 'resolved' : 'normal'} label={d.trusted ? 'trusted' : 'unrecognized'} /></td><td style={td()}>{new Date(d.last_seen).toLocaleString('en-NG')}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}

function KV({ k, v, cap }: { k: string; v: string; cap?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: `1px solid ${colors.border}`, fontSize: '0.85rem' }}>
      <span style={{ color: colors.muted }}>{k}</span>
      <span style={{ fontWeight: 600, textTransform: cap ? 'capitalize' : 'none' }}>{v}</span>
    </div>
  );
}
