'use client';

import Link from 'next/link';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

export default function ConnectCatalogPage() {
  return (
    <Page>
      <PageHeader title="Catalog & content" subtitle="Gift catalog and pricing. Gift prices are real money in kobo; gifting settles via the Paymax wallet/ledger." />
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: 14 }}>
          <Link href="/admin/connect/catalog/gifts" style={{ display: 'block', padding: '1rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', textDecoration: 'none' }}>
            <strong style={{ display: 'block', color: colors.text }}>Gift catalog →</strong>
            <span style={{ color: colors.muted, fontSize: '0.8rem' }}>Gift → amount (kobo) mapping & animations</span>
          </Link>
          <Link href="/admin/connect/comms" style={{ display: 'block', padding: '1rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', textDecoration: 'none' }}>
            <strong style={{ display: 'block', color: colors.text }}>Announcements & push →</strong>
            <span style={{ color: colors.muted, fontSize: '0.8rem' }}>Composer and templates</span>
          </Link>
        </div>
      </Card>
    </Page>
  );
}
