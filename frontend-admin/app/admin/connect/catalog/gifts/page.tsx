'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listGiftCatalogAdmin, nairaFromKobo, type ConnectGift } from '@/services/connectAdminOpsService';
import { PageHeader, Card, Badge, btn, th, td } from '../../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <Link href="/admin/connect/catalog" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>← Catalog</Link>
      <div style={{ height: 8 }} />
      <PageHeader title="Gift catalog" subtitle="Prices are stored as integer minor units (kobo). Display shows the Naira equivalent." action={<button onClick={load} style={btn()}>Refresh</button>} />

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
        <button onClick={() => setOnlyActive(false)} style={{ ...btn(), background: !onlyActive ? '#340075' : '#fff', color: !onlyActive ? '#fff' : '#374151' }}>All</button>
        <button onClick={() => setOnlyActive(true)} style={{ ...btn(), background: onlyActive ? '#340075' : '#fff', color: onlyActive ? '#fff' : '#374151' }}>Active only</button>
      </div>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading catalog…</p> : visible.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No gifts in the catalog.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Gift</th><th style={th()}>Category</th><th style={th()}>Price (kobo)</th><th style={th()}>Price (₦)</th><th style={th()}>Animation</th><th style={th()}>State</th></tr></thead>
            <tbody>
              {visible.map((g) => (
                <tr key={g.id}>
                  <td style={td()}><span style={{ fontSize: '1.1rem', marginRight: 6 }}>{g.emoji}</span><strong>{g.name}</strong></td>
                  <td style={td()}>{g.category}</td>
                  <td style={td()}><code style={{ fontSize: '0.8rem' }}>{g.price_kobo.toLocaleString()}</code></td>
                  <td style={td()}>{nairaFromKobo(g.price_kobo)}</td>
                  <td style={td()}>{g.animation}</td>
                  <td style={td()}><Badge status={g.active ? 'resolved' : 'closed'} label={g.active ? 'active' : 'inactive'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
