'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RedFlagQueueRow } from '@/types/intakeAdmin';
import { listRedFlagQueue, toLocal } from '@/services/intakeAdminService';
import { BackLink, PageHeader, Notice, th, td, SeverityBadge, RoutingBadge, DispositionBadge } from '../_ui';

export default function RedFlagQueuePage() {
  const [rows, setRows] = useState<RedFlagQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listRedFlagQueue());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Order: open cases first, crisis grouped for visibility.
  const sorted = [...rows].sort((a, b) => {
    const openRank = (d: string) => (d === 'OPEN' ? 0 : d === 'ROUTED' || d === 'CONTACTED' ? 1 : 2);
    return openRank(a.disposition) - openRank(b.disposition);
  });

  return (
    <div>
      <BackLink />
      <PageHeader title="A11 · Red-flag Queue" subtitle="Cases where intake answers triggered the safety triage gate, with their routing and current disposition. The goal is to make sure each person gets the right support quickly." />
      <Notice kind="support">
        These represent people who may need care urgently. Handle each case calmly and with compassion — especially crisis-routed cases, where a supportive first contact matters most.
      </Notice>

      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      {loading ? <p style={{ opacity: 0.6, marginTop: 16 }}>Loading…</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['Intake', 'Appointment', 'Severity', 'Routing', 'Triggered rules', 'Created', 'Disposition'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isCrisis = r.routing === 'CRISIS';
              return (
                <tr key={r.intake_id} style={{ borderBottom: '1px solid #1c1c1c', background: isCrisis ? 'rgba(19,52,59,0.45)' : undefined, borderLeft: isCrisis ? '3px solid #22d3ee' : '3px solid transparent' }}>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>
                    {r.intake_id}
                    {isCrisis ? <div style={{ fontSize: 11, color: '#a5f3fc', marginTop: 2 }}>Connect with supportive care</div> : null}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.appointment_id}</td>
                  <td style={td}><SeverityBadge severity={r.severity} /></td>
                  <td style={td}><RoutingBadge routing={r.routing} /></td>
                  <td style={td}>{r.rule_codes.map((c) => <span key={c} style={{ fontFamily: 'monospace', fontSize: 11, background: '#1f1f1f', padding: '1px 6px', borderRadius: 4, marginRight: 4 }}>{c}</span>)}</td>
                  <td style={{ ...td, opacity: 0.8, whiteSpace: 'nowrap' }}>{toLocal(r.created_at)}</td>
                  <td style={td}><DispositionBadge disposition={r.disposition} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
