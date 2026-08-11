'use client';

import { useEffect, useState } from 'react';
import { getFloatRecon, formatNaira } from '@/services/savingsAdminService';
import type { FloatRecon } from '@/types/savingsAdmin';
import { SavingsTabs, Kpi, DisclosureNote, StateBlock, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const SUCCESS_STATUSES = new Set(['active', 'open', 'matured', 'completed', 'settled', 'reconciled', 'resolved', 'paid', 'healthy', 'approved', 'on_track', 'recovered', 'cleared', 'balanced', 'verified', 'contribution']);
const DANGER_STATUSES = new Set(['rejected', 'failed', 'defaulted', 'blocked', 'high', 'critical', 'breached', 'suspended', 'impersonation', 'abuse']);
const WARNING_STATUSES = new Set(['pending', 'forming', 'scheduled', 'queued', 'flagged', 'degraded', 'at_risk', 'locked', 'grace', 'review', 'under_review', 'late', 'medium', 'debit', 'hold']);
const INFO_STATUSES = new Set(['investigating', 'processing', 'collecting', 'flex', 'normal', 'invited', 'payment', 'split', 'payout']);
const PRIMARY_STATUSES = new Set(['refunded', 'reversed', 'reversal', 'make_good', 'pool', 'request']);

function badgeColor(status: string): string {
  const s = status.toLowerCase();
  if (SUCCESS_STATUSES.has(s)) return colors.success;
  if (DANGER_STATUSES.has(s)) return colors.danger;
  if (WARNING_STATUSES.has(s)) return colors.warning;
  if (INFO_STATUSES.has(s)) return colors.info;
  if (PRIMARY_STATUSES.has(s)) return colors.primary;
  return colors.secondary;
}

function badgeText(status: string, label?: string): string {
  const t = (label ?? status.replace(/_/g, ' ')).toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function FloatReconPage() {
  const [data, setData] = useState<FloatRecon | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getFloatRecon()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <Page>
      <PageHeader title="Float reconciliation" subtitle="Ledger projections vs custody float per savings product. Deltas must trend to zero." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <SavingsTabs active="float" />
      <DisclosureNote>NL-8 — wallet / sub-balances are projections of the immutable double-entry ledger; balances are never updated directly. A non-zero delta is a reconciliation break requiring a reversing-entry correction, never a balance edit.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={!data} emptyText="No reconciliation data.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Ledger total" value={formatNaira(data.total_ledger_kobo)} accent={colors.primary} />
              <Kpi label="Custody total" value={formatNaira(data.total_custody_kobo)} />
              <Kpi label="Total delta" value={formatNaira(data.total_delta_kobo)} sub={data.total_delta_kobo === 0 ? 'Balanced' : 'Break open'} accent={data.total_delta_kobo === 0 ? colors.success : colors.danger} />
              <Kpi label="Generated" value={timeAgo(data.generated_at)} />
            </div>

            <Card title="Reconciliation by product">
              {data.lines.length === 0 ? <p style={{ color: colors.muted }}>No lines.</p> : (
                <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>Product</th><th style={thCell}>Ledger</th><th style={thCell}>Custody</th><th style={thCell}>Delta</th><th style={thCell}>Status</th><th style={thCell}>As of</th>
                  </tr></thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.id}>
                        <td style={tdCell}><Badge text={badgeText(l.product)} color={badgeColor(l.product)} /></td>
                        <td style={tdCell}>{formatNaira(l.ledger_balance_kobo)}</td>
                        <td style={tdCell}>{formatNaira(l.custody_balance_kobo)}</td>
                        <td style={{ ...tdCell, color: l.delta_kobo === 0 ? colors.success : colors.danger, fontWeight: 600 }}>{formatNaira(l.delta_kobo)}</td>
                        <td style={tdCell}><Badge text={badgeText(l.status)} color={badgeColor(l.status)} /></td>
                        <td style={tdCell}>{timeAgo(l.as_of)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
