'use client';

import { useEffect, useState } from 'react';
import { getConnectFinance, formatNaira } from '@/services/connectAdminService';
import type { ConnectFinanceSummary } from '@/types/connectAdmin';
import { ConnectTabs } from '../_ui';
import { Page, PageHeader, Card, Button, colors } from '@/components/ui/vuexy';

export default function ConnectFinancePage() {
  const [data, setData] = useState<ConnectFinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getConnectFinance()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const balanced = data ? data.ledger_debits_kobo === data.ledger_credits_kobo : true;

  return (
    <Page>
      <PageHeader title="Finance overview" subtitle="Gift volume, ledger summary & float (§11.5). All figures in kobo, displayed as Naira." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />
      <ConnectTabs active="overview" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading ? (
        <Card><p style={{ color: colors.muted }}>Loading finance summary…</p></Card>
      ) : !data ? (
        <Card><p style={{ color: colors.muted }}>No finance data available.</p></Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Money label="Gift volume (today)" v={data.gift_volume_today_kobo} accent={colors.primary} />
            <Money label="Gift volume (30d)" v={data.gift_volume_30d_kobo} />
            <Money label="Paid-vote volume (30d)" v={data.paid_vote_volume_30d_kobo} />
            <Money label="Payout volume (30d)" v={data.payout_volume_30d_kobo} />
            <Money label="Take-rate (30d)" v={data.take_rate_30d_kobo} accent={colors.success} />
            <Money label="Float balance" v={data.float_balance_kobo} />
            <Money label="Pending payouts" v={data.pending_payouts_kobo} accent={colors.warning} />
          </div>

          <Card title="Ledger summary (double-entry)">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <tbody>
                <tr><td style={{ padding: '0.5rem 0', color: colors.muted }}>Total debits</td><td style={{ padding: '0.5rem 0', textAlign: 'right', fontWeight: 600 }}>{formatNaira(data.ledger_debits_kobo)}</td></tr>
                <tr><td style={{ padding: '0.5rem 0', color: colors.muted, borderTop: `1px solid ${colors.border}` }}>Total credits</td><td style={{ padding: '0.5rem 0', textAlign: 'right', fontWeight: 600, borderTop: `1px solid ${colors.border}` }}>{formatNaira(data.ledger_credits_kobo)}</td></tr>
                <tr><td style={{ padding: '0.5rem 0', color: colors.muted, borderTop: `1px solid ${colors.border}`, fontWeight: 700 }}>Balanced</td><td style={{ padding: '0.5rem 0', textAlign: 'right', fontWeight: 700, borderTop: `1px solid ${colors.border}`, color: balanced ? colors.success : colors.danger }}>{balanced ? 'Yes — debits = credits' : 'NO — out of balance'}</td></tr>
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Page>
  );
}

function Money({ label, v, accent }: { label: string; v: number; accent?: string }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.85rem 1rem', background: colors.card }}>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem', color: accent ?? colors.text }}>{formatNaira(v)}</div>
    </div>
  );
}
