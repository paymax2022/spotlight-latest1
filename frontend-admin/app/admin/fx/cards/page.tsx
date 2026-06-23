'use client';

import { useEffect, useState } from 'react';
import { getIssuedCards, setIssuedCardStatus, getSuspiciousCardActivity } from '@/services/fxAdminService';
import type { IssuedCard, SuspiciousCardActivity } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, btnPrimary, th, td, moneyFull } from '../_ui';

const SEV_COLOR: Record<string, string> = { high: '#dc2626', medium: '#d97706', low: '#6b7280' };

export default function FxCardsRegistryPage() {
  const [cards, setCards] = useState<IssuedCard[]>([]);
  const [suspicious, setSuspicious] = useState<SuspiciousCardActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { const [c, s] = await Promise.all([getIssuedCards(), getSuspiciousCardActivity()]); setCards(c); setSuspicious(s); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function act(id: string, status: IssuedCard['status']) { setBusy(id); try { await setIssuedCardStatus(id, status); await load(); } finally { setBusy(null); } }
  const cardLabel = (id: string) => { const c = cards.find((x) => x.id === id); return c ? `${c.customer} ••${c.last4}` : id; };

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Cards" subtitle="Issued-card registry, program controls and suspicious activity." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="cards" />

      <Card title="Issued-card registry">
        {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}><th style={th()}>Customer</th><th style={th()}>Brand</th><th style={th()}>Card</th><th style={th()}>Balance</th><th style={th()}>Spent</th><th style={th()}>Issuer</th><th style={th()}>Status</th><th style={th()}></th></tr></thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}><strong>{c.customer}</strong></td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{c.brand}</td>
                  <td style={td()}>•••• {c.last4} <span style={{ color: '#9ca3af' }}>{c.currency}</span></td>
                  <td style={td()}>{moneyFull(c.balanceMinor, c.currency)}</td>
                  <td style={td()}>{moneyFull(c.spentMinor, c.currency)}</td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{c.provider}</td>
                  <td style={td()}><Badge status={c.status} /></td>
                  <td style={{ ...td(), textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {c.status === 'active' ? <button disabled={busy === c.id} onClick={() => act(c.id, 'frozen')} style={{ ...btn(), marginRight: 6 }}>Freeze</button> : c.status === 'frozen' ? <button disabled={busy === c.id} onClick={() => act(c.id, 'active')} style={{ ...btn(), marginRight: 6 }}>Unfreeze</button> : null}
                    {c.status !== 'terminated' ? <button disabled={busy === c.id} onClick={() => act(c.id, 'terminated')} style={btnPrimary('#dc2626')}>Terminate</button> : <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.75rem' }}>Issuing is routed to the issuing-capable provider (Maplerad at V1). PCI card data is isolated; only last-4 is shown here.</p>
      </Card>

      <Card title="Suspicious card activity">
        {suspicious.length === 0 ? <p style={{ color: '#6b7280' }}>No suspicious activity flagged.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}><th style={th()}>Card</th><th style={th()}>Reason</th><th style={th()}>Severity</th><th style={th()}>When</th></tr></thead>
            <tbody>
              {suspicious.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}><strong>{cardLabel(s.cardId)}</strong></td>
                  <td style={td()}>{s.reason}</td>
                  <td style={{ ...td(), color: SEV_COLOR[s.severity], fontWeight: 600, textTransform: 'capitalize' }}>{s.severity}</td>
                  <td style={{ ...td(), color: '#6b7280' }}>{new Date(s.createdAt).toLocaleString('en-NG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
