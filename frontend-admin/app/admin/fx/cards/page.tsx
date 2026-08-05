'use client';

import { useEffect, useState } from 'react';
import { getIssuedCards, setIssuedCardStatus, getSuspiciousCardActivity } from '@/services/fxAdminService';
import type { IssuedCard, SuspiciousCardActivity } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, moneyFull } from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const SEV_COLOR: Record<string, string> = { high: colors.danger, medium: colors.warning, low: colors.muted };

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
      <PageHeader title="Cards" subtitle="Issued-card registry, program controls and suspicious activity." action={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <FxTabs active="cards" />

      <Card title="Issued-card registry">
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Customer</th><th style={thCell}>Brand</th><th style={thCell}>Card</th><th style={thCell}>Balance</th><th style={thCell}>Spent</th><th style={thCell}>Issuer</th><th style={thCell}>Status</th><th style={thCell}></th></tr></thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}><strong>{c.customer}</strong></td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{c.brand}</td>
                  <td style={tdCell}>•••• {c.last4} <span style={{ color: colors.muted }}>{c.currency}</span></td>
                  <td style={tdCell}>{moneyFull(c.balanceMinor, c.currency)}</td>
                  <td style={tdCell}>{moneyFull(c.spentMinor, c.currency)}</td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{c.provider}</td>
                  <td style={tdCell}><Badge status={c.status} /></td>
                  <td style={{ ...tdCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {c.status === 'active' ? <Button variant="outline" sm disabled={busy === c.id} onClick={() => act(c.id, 'frozen')} style={{ marginRight: 6 }}>Freeze</Button> : c.status === 'frozen' ? <Button variant="outline" sm disabled={busy === c.id} onClick={() => act(c.id, 'active')} style={{ marginRight: 6 }}>Unfreeze</Button> : null}
                    {c.status !== 'terminated' ? <Button variant="danger" sm disabled={busy === c.id} onClick={() => act(c.id, 'terminated')}>Terminate</Button> : <span style={{ color: colors.muted }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: '0.75rem' }}>Issuing is routed to the issuing-capable provider (Maplerad at V1). PCI card data is isolated; only last-4 is shown here.</p>
      </Card>

      <Card title="Suspicious card activity">
        {suspicious.length === 0 ? <p style={{ color: colors.muted }}>No suspicious activity flagged.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}><th style={thCell}>Card</th><th style={thCell}>Reason</th><th style={thCell}>Severity</th><th style={thCell}>When</th></tr></thead>
            <tbody>
              {suspicious.map((s) => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}><strong>{cardLabel(s.cardId)}</strong></td>
                  <td style={tdCell}>{s.reason}</td>
                  <td style={{ ...tdCell, color: SEV_COLOR[s.severity], fontWeight: 600, textTransform: 'capitalize' }}>{s.severity}</td>
                  <td style={{ ...tdCell, color: colors.muted }}>{new Date(s.createdAt).toLocaleString('en-NG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
