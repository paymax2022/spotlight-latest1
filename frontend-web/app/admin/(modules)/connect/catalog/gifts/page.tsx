'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listGiftCatalogAdmin, nairaFromKobo, type ConnectGift } from '@/services/connectAdminOpsService';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function ConnectGiftCatalogPage() {
  const [rows, setRows] = useState<ConnectGift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyActive, setOnlyActive] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listGiftCatalogAdmin()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const visible = onlyActive ? rows.filter((g) => g.active) : rows;

  return (
    <Page>
      <Link href="/admin/connect/catalog" style={{ color: colors.primary, textDecoration: 'none', fontSize: '0.85rem' }}>← Catalog</Link>
      <div style={{ height: 8 }} />
      <PageHeader title="Gift catalog" subtitle="Prices are stored as integer minor units (kobo). Display shows the Naira equivalent." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
        <Button variant={!onlyActive ? 'primary' : 'outline'} sm onClick={() => setOnlyActive(false)}>All</Button>
        <Button variant={onlyActive ? 'primary' : 'outline'} sm onClick={() => setOnlyActive(true)}>Active only</Button>
      </div>
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading catalog…</p> : visible.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>No gifts in the catalog.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Gift</th><th style={thCell}>Category</th><th style={thCell}>Price (kobo)</th><th style={thCell}>Price (₦)</th><th style={thCell}>Animation</th><th style={thCell}>State</th></tr></thead>
            <tbody>
              {visible.map((g) => (
                <tr key={g.id}>
                  <td style={tdCell}><span style={{ fontSize: '1.1rem', marginRight: 6 }}>{g.emoji}</span><strong>{g.name}</strong></td>
                  <td style={tdCell}>{g.category}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.8rem' }}>{g.price_kobo.toLocaleString()}</code></td>
                  <td style={tdCell}>{nairaFromKobo(g.price_kobo)}</td>
                  <td style={tdCell}>{g.animation}</td>
                  <td style={tdCell}><Badge text={g.active ? 'active' : 'inactive'} color={g.active ? colors.success : colors.secondary} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
