'use client';

import { useCallback, useEffect, useState } from 'react';
import { listLoyaltyAudit } from '@/services/connectNetworkAdminService';
import type { LoyaltyAuditEntry } from '@/types/connectNetworkAdmin';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

export default function ConnectLoyaltyAuditPage() {
  const [rows, setRows] = useState<LoyaltyAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listLoyaltyAudit('connect')); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Page>
      <PageHeader title="Loyalty event audit" subtitle="ADM-GM-01 · Trace every Paymax Black grant from a Phase-6 (module=connect) action back to its source." actions={<Button variant="outline" sm onClick={() => void load()}>Refresh</Button>} />

      <Card>
        <div style={{ background: tint(colors.warning, 0.12), border: `1px solid ${tint(colors.warning, 0.4)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', color: colors.warning, fontSize: '0.82rem' }}>
          <strong>Non-cash invariant.</strong> Paymax Black points are engagement rewards, not money. This is a read-only trace — points here are never converted to wallet balance.
        </div>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading audit trail…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No loyalty grants recorded for this module.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Subject</th><th style={thCell}>Module</th><th style={thCell}>Event</th><th style={thCell}>Points</th><th style={thCell}>Source trace</th><th style={thCell}>Granted</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td style={tdCell}>{l.subjectId}</td>
                  <td style={tdCell}><Badge text={l.module} color={colors.info} /></td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{l.eventType}</code></td>
                  <td style={tdCell}><strong>{l.points}</strong> <span style={{ color: colors.muted, fontSize: '0.72rem' }}>pts</span></td>
                  <td style={tdCell}><code style={{ fontSize: '0.75rem' }}>{l.sourceRef}</code></td>
                  <td style={tdCell}>{timeAgo(l.grantedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
