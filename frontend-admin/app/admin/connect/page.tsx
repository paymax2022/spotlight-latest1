'use client';

import { PageHeader, ConnectTabs, Card } from './_ui';
import { Page, colors } from '@/components/ui/vuexy';

export default function ConnectOverviewPage() {
  return (
    <Page>
      <PageHeader title="Paymax Connect" subtitle="Trust-first, verified, 18+ dating & networking — moderation, safety cases and audit." />
      <ConnectTabs active="overview" />
      <Card title="Phase 0 — foundation">
        <p style={{ color: colors.text, fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
          The Connect safety/config backbone is live: backend-owned config, an immutable audit log,
          the safety-case scaffold, the 18+ age gate with an underage review queue, and verification
          data hooks (store-nothing-raw hashing + retention). Feature screens arrive in Phase 1.
        </p>
        <ul style={{ color: colors.text, fontSize: '0.85rem', lineHeight: 1.7, marginTop: '0.75rem' }}>
          <li><strong>Safety cases</strong> — every report opens an auditable case that never fails silently.</li>
          <li><strong>Audit log</strong> — immutable; admin-read only.</li>
          <li><strong>Config</strong> — flags, matching weights and limits are backend-owned; mobile reads only the public subset.</li>
        </ul>
      </Card>
    </Page>
  );
}
