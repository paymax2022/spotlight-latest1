'use client';

import Link from 'next/link';
import { PageHeader, Card, btn } from '../_ui';

export default function ConnectCatalogPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Catalog & content" subtitle="Gift catalog and pricing. Gift prices are real money in kobo; gifting settles via the Paymax wallet/ledger." />
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <Link href="/admin/connect/catalog/gifts" style={{ ...btn(), display: 'block', padding: '1rem' }}>
            <strong style={{ display: 'block', color: '#111827' }}>Gift catalog →</strong>
            <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>Gift → amount (kobo) mapping & animations</span>
          </Link>
          <Link href="/admin/connect/comms" style={{ ...btn(), display: 'block', padding: '1rem' }}>
            <strong style={{ display: 'block', color: '#111827' }}>Announcements & push →</strong>
            <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>Composer and templates</span>
          </Link>
        </div>
      </Card>
    </div>
  );
}
