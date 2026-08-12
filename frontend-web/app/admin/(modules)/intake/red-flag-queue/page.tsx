'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { RedFlagQueueRow } from '@/types/intakeAdmin';
import { listRedFlagQueue, toLocal } from '@/services/intakeAdminService';
import { Page, PageHeader, Card, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const SEVERITY_COLORS: Record<string, string> = {
  emergency: colors.danger,
  urgent: colors.warning,
};

const ROUTING_COLORS: Record<string, string> = {
  EMERGENCY: colors.danger,
  URGENT_CARE: colors.warning,
  CRISIS: colors.info,
};

const DISPOSITION_COLORS: Record<string, string> = {
  OPEN: colors.warning,
  ROUTED: colors.info,
  CONTACTED: colors.info,
  RESOLVED: colors.success,
};

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.success, 0.12), border: `1px solid ${tint(colors.success, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>🤝</span>
      <span>{children}</span>
    </div>
  );
}

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
    <Page>
      <div style={{ marginBottom: 14 }}>
        <Link href="/admin/intake" style={{ fontSize: 13, color: colors.primary }}>← Intake console</Link>
      </div>
      <PageHeader title="A11 · Red-flag Queue" subtitle="Cases where intake answers triggered the safety triage gate, with their routing and current disposition. The goal is to make sure each person gets the right support quickly." />
      <Notice>
        These represent people who may need care urgently. Handle each case calmly and with compassion — especially crisis-routed cases, where a supportive first contact matters most.
      </Notice>

      {error ? <p style={{ color: colors.danger }}>{error}</p> : null}

      {loading ? <p style={{ color: colors.muted, marginTop: 16 }}>Loading…</p> : (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Intake', 'Appointment', 'Severity', 'Routing', 'Triggered rules', 'Created', 'Disposition'].map((h) => <th key={h} style={thCell}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isCrisis = r.routing === 'CRISIS';
                return (
                  <tr key={r.intake_id} style={{ background: isCrisis ? tint(colors.info, 0.1) : undefined, borderLeft: isCrisis ? `3px solid ${colors.info}` : '3px solid transparent' }}>
                    <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>
                      {r.intake_id}
                      {isCrisis ? <div style={{ fontSize: 11, color: colors.info, marginTop: 2 }}>Connect with supportive care</div> : null}
                    </td>
                    <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 11 }}>{r.appointment_id}</td>
                    <td style={tdCell}><Badge text={r.severity} color={SEVERITY_COLORS[r.severity] ?? colors.secondary} /></td>
                    <td style={tdCell}><Badge text={r.routing === 'CRISIS' ? 'Crisis support' : r.routing.replace(/_/g, ' ').toLowerCase()} color={ROUTING_COLORS[r.routing] ?? colors.secondary} /></td>
                    <td style={tdCell}>{r.rule_codes.map((c) => <span key={c} style={{ fontFamily: 'monospace', fontSize: 11, background: colors.headBg, padding: '1px 6px', borderRadius: 4, marginRight: 4 }}>{c}</span>)}</td>
                    <td style={{ ...tdCell, color: colors.muted, whiteSpace: 'nowrap' }}>{toLocal(r.created_at)}</td>
                    <td style={tdCell}><Badge text={r.disposition.toLowerCase()} color={DISPOSITION_COLORS[r.disposition] ?? colors.secondary} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
