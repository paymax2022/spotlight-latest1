'use client';

import { useEffect, useState } from 'react';
import { getVaRegistry, getCollectionEvents, getBeneficiaryIssues } from '@/services/fxAdminService';
import type { VirtualAccountReg, AdminCollectionEvent, BeneficiaryValidationIssue } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, moneyFull } from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function FxCollectionsPage() {
  const [vas, setVas] = useState<VirtualAccountReg[]>([]);
  const [events, setEvents] = useState<AdminCollectionEvent[]>([]);
  const [issues, setIssues] = useState<BeneficiaryValidationIssue[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { const [a, b, c] = await Promise.all([getVaRegistry(), getCollectionEvents(), getBeneficiaryIssues()]); setVas(a); setEvents(b); setIssues(c); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Beneficiaries & Collections" subtitle="Virtual account / IBAN registry, collection events and validation issues." action={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <FxTabs active="collections" />

      <Card title="Virtual account / IBAN registry">
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Customer</th><th style={thCell}>Currency</th><th style={thCell}>Type</th><th style={thCell}>Identifier</th><th style={thCell}>Provider</th><th style={thCell}>Status</th></tr></thead>
            <tbody>
              {vas.map((v) => (
                <tr key={v.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}><strong>{v.customer}</strong></td>
                  <td style={tdCell}>{v.currency}</td>
                  <td style={tdCell}>{v.type === 'iban' ? 'IBAN' : 'Virtual account'}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{v.identifier}</code></td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{v.provider}</td>
                  <td style={tdCell}><Badge status={v.status === 'active' ? 'successful' : 'failed'} label={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Recent collection events">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Customer</th><th style={thCell}>Amount</th><th style={thCell}>Sender</th><th style={thCell}>Reference</th><th style={thCell}>When</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={tdCell}><strong>{e.customer}</strong></td>
                <td style={tdCell}>+{moneyFull(e.amountMinor, e.currency)}</td>
                <td style={tdCell}>{e.sender ?? '—'}</td>
                <td style={tdCell}>{e.reference ?? '—'}</td>
                <td style={{ ...tdCell, color: colors.muted }}>{new Date(e.createdAt).toLocaleString('en-NG')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Beneficiary validation issues by corridor">
        {issues.length === 0 ? <p style={{ color: colors.muted }}>No outstanding validation issues.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Corridor</th><th style={thCell}>Beneficiary</th><th style={thCell}>Rail</th><th style={thCell}>Reason</th><th style={thCell}>Count</th></tr></thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}><strong>{i.corridor}</strong></td>
                  <td style={tdCell}>{i.beneficiary}</td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{i.rail.replace('_', ' ')}</td>
                  <td style={{ ...tdCell, color: colors.warning }}>{i.reason}</td>
                  <td style={tdCell}>{i.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
