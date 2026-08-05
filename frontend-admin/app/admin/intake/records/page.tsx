'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Page, PageHeader, Card, Button, Input, colors, tint } from '@/components/ui/vuexy';

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.warning, 0.12), border: `1px solid ${tint(colors.warning, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>🔒</span>
      <span>{children}</span>
    </div>
  );
}

export default function RecordLookupPage() {
  const router = useRouter();
  const [id, setId] = useState('');

  const open = () => {
    const v = id.trim();
    if (v) router.push(`/admin/intake/records/${encodeURIComponent(v)}`);
  };

  return (
    <Page>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake" style={{ fontSize: 13, color: colors.primary }}>← Intake console</Link>
      </div>
      <PageHeader title="A9 · Intake Record Viewer" subtitle="Open a single appointment's intake for support or clinical-admin review. Read-only." />
      <Notice>
        Intake is sensitive health data. Opening a record is access-controlled and <strong>audit-logged</strong> — your identity, the record, and the time are recorded in the Access &amp; Audit Log.
      </Notice>

      <Card style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12 }}>Appointment ID
          <Input style={{ display: 'block', width: 240 }} placeholder="APT-90211" value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') open(); }} />
        </label>
        <Button variant="primary" disabled={!id.trim()} onClick={open}>Open record</Button>
      </Card>
      <p style={{ fontSize: 12, color: colors.muted, marginTop: 12 }}>Tip: open records directly from Intake Monitoring (A8).</p>
    </Page>
  );
}
