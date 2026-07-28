'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BackLink, PageHeader, Notice, card, btn, btnPrimary, input } from '../_ui';

export default function RecordLookupPage() {
  const router = useRouter();
  const [id, setId] = useState('');

  const open = () => {
    const v = id.trim();
    if (v) router.push(`/admin/intake/records/${encodeURIComponent(v)}`);
  };

  return (
    <div>
      <BackLink />
      <PageHeader title="A9 · Intake Record Viewer" subtitle="Open a single appointment's intake for support or clinical-admin review. Read-only." />
      <Notice kind="audit">
        Intake is sensitive health data. Opening a record is access-controlled and <strong>audit-logged</strong> — your identity, the record, and the time are recorded in the Access &amp; Audit Log.
      </Notice>

      <div style={{ ...card, marginTop: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12 }}>Appointment ID
          <input style={{ ...input, display: 'block', width: 240 }} placeholder="APT-90211" value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') open(); }} />
        </label>
        <button style={id.trim() ? btnPrimary : { ...btn, opacity: 0.5 }} disabled={!id.trim()} onClick={open}>Open record</button>
      </div>
      <p style={{ fontSize: 12, opacity: 0.5, marginTop: 12 }}>Tip: open records directly from Intake Monitoring (A8).</p>
    </div>
  );
}
