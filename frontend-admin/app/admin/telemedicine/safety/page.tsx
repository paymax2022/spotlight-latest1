'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader, TelemedTabs, DisclosureNote, Card, StateBlock, btn, th, td, fmtDate } from '../_ui';
import { QueueBoard } from '../support/_queue';
import { listFacilities, type Facility } from '@/services/telemedAdminSupportService';

function Facilities() {
  const [rows, setRows] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listFacilities()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const where = (f: Facility) => {
    const l = f.location ?? {};
    return [l.address, l.city, l.state].filter((x) => typeof x === 'string' && x).join(', ') || '—';
  };

  return (
    <Card title="Saved emergency facilities" right={<button style={btn()} onClick={load}>Refresh</button>}>
      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No clinician has saved an emergency facility yet.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th()}>Facility</th><th style={th()}>Type</th><th style={th()}>Location</th><th style={th()}>Saved</th></tr></thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td style={td()}>{f.name || '—'}</td>
                <td style={{ ...td(), textTransform: 'capitalize' }}>{f.facility_type || '—'}</td>
                <td style={td()}>{where(f)}</td>
                <td style={td()}>{fmtDate(f.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </StateBlock>
    </Card>
  );
}

export default function TelemedSafetyPage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Safety & emergencies"
        subtitle="Patient-safety reports, emergency cases and escalations (hospital, ambulance, contact) raised by clinicians. Patient identity is masked."
      />
      <TelemedTabs active="safety" />
      <DisclosureNote>
        Live queues from <code>/api/v1/telemedicine/admin/safety/*</code> and <code>/emergencies/*</code>. Free-form payloads are
        scrubbed of names, phone numbers, emails and addresses before they reach this screen. Status changes notify the clinician.
      </DisclosureNote>
      <QueueBoard kinds={['safety_issue', 'emergency_case', 'emergency_escalation']} />
      <Facilities />
    </div>
  );
}
