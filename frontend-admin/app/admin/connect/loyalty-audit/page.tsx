'use client';

import { useCallback, useEffect, useState } from 'react';
import { listLoyaltyAudit } from '@/services/connectNetworkAdminService';
import type { LoyaltyAuditEntry } from '@/types/connectNetworkAdmin';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Loyalty event audit" subtitle="ADM-GM-01 · Trace every Paymax Black grant from a Phase-6 (module=connect) action back to its source." action={<button onClick={() => void load()} style={btn()}>Refresh</button>} />

      <Card>
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', color: '#9a3412', fontSize: '0.82rem' }}>
          <strong>Non-cash invariant.</strong> Paymax Black points are engagement rewards, not money. This is a read-only trace — points here are never converted to wallet balance.
        </div>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading audit trail…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No loyalty grants recorded for this module.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Subject</th><th style={th()}>Module</th><th style={th()}>Event</th><th style={th()}>Points</th><th style={th()}>Source trace</th><th style={th()}>Granted</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td style={td()}>{l.subjectId}</td>
                  <td style={td()}><Badge status="normal" label={l.module} /></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{l.eventType}</code></td>
                  <td style={td()}><strong>{l.points}</strong> <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>pts</span></td>
                  <td style={td()}><code style={{ fontSize: '0.75rem' }}>{l.sourceRef}</code></td>
                  <td style={td()}>{timeAgo(l.grantedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
