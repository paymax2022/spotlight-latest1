'use client';

import { useEffect, useState } from 'react';
import { getVaRegistry, getCollectionEvents, getBeneficiaryIssues } from '@/services/fxAdminService';
import type { VirtualAccountReg, AdminCollectionEvent, BeneficiaryValidationIssue } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, th, td, moneyFull } from '../_ui';

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
      <PageHeader title="Beneficiaries & Collections" subtitle="Virtual account / IBAN registry, collection events and validation issues." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="collections" />

      <Card title="Virtual account / IBAN registry">
        {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}><th style={th()}>Customer</th><th style={th()}>Currency</th><th style={th()}>Type</th><th style={th()}>Identifier</th><th style={th()}>Provider</th><th style={th()}>Status</th></tr></thead>
            <tbody>
              {vas.map((v) => (
                <tr key={v.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}><strong>{v.customer}</strong></td>
                  <td style={td()}>{v.currency}</td>
                  <td style={td()}>{v.type === 'iban' ? 'IBAN' : 'Virtual account'}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{v.identifier}</code></td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{v.provider}</td>
                  <td style={td()}><Badge status={v.status === 'active' ? 'successful' : 'failed'} label={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Recent collection events">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}><th style={th()}>Customer</th><th style={th()}>Amount</th><th style={th()}>Sender</th><th style={th()}>Reference</th><th style={th()}>When</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td()}><strong>{e.customer}</strong></td>
                <td style={td()}>+{moneyFull(e.amountMinor, e.currency)}</td>
                <td style={td()}>{e.sender ?? '—'}</td>
                <td style={td()}>{e.reference ?? '—'}</td>
                <td style={{ ...td(), color: '#6b7280' }}>{new Date(e.createdAt).toLocaleString('en-NG')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Beneficiary validation issues by corridor">
        {issues.length === 0 ? <p style={{ color: '#6b7280' }}>No outstanding validation issues.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}><th style={th()}>Corridor</th><th style={th()}>Beneficiary</th><th style={th()}>Rail</th><th style={th()}>Reason</th><th style={th()}>Count</th></tr></thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}><strong>{i.corridor}</strong></td>
                  <td style={td()}>{i.beneficiary}</td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{i.rail.replace('_', ' ')}</td>
                  <td style={{ ...td(), color: '#9a3412' }}>{i.reason}</td>
                  <td style={td()}>{i.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
