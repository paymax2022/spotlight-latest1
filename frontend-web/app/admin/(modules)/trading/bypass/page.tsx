'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listBypassRegister, formatKobo } from '@/services/tradingAdminService';
import type { TradingBypassEntry } from '@/types/tradingAdmin';
import {
  PageHeader, TradingTabs, Card, StatusBadge, DisclosureNote, StateBlock, PermissionBanner,
  btn, th, td, fmtDate, TRADING_PERMS, useTradingPermission,
} from '../_ui';

// Bypass register (§16B.1/16B.5): every BYPASSED grant — maker/checker pair,
// justification, time-box, exposure cap, and active/revoked/expired state — for
// standing compliance review + audit export.
export default function TradingBypassRegisterPage() {
  const { allowed: canView } = useTradingPermission(TRADING_PERMS.auditRead, TRADING_PERMS.bypassApprove);
  const [rows, setRows] = useState<TradingBypassEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listBypassRegister()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const now = Date.now();
  const shown = rows.filter((r) => !activeOnly || (r.revoked_at == null && new Date(r.expires_at).getTime() > now));

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Trading — Bypass Register"
        subtitle="Every KYC bypass grant, for compliance review and audit export."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <TradingTabs active="bypass" />
      <DisclosureNote>
        A bypass grants trading access <strong>without</strong> standard verification. Each is a two-person, time-boxed,
        auto-expiring exception with a mandatory justification (§16B.1). This register is the standing compliance view —
        it should be reviewed regularly and exported for audit.
      </DisclosureNote>

      {!canView && <PermissionBanner permission={TRADING_PERMS.auditRead} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#374151', marginBottom: '1rem' }}>
        <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active bypasses only
      </label>

      <Card>
        <StateBlock loading={loading} error={null} empty={shown.length === 0} emptyText="No bypass grants on record.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>User</th><th style={th()}>Maker → Checker</th><th style={th()}>Justification</th>
              <th style={th()}>Cap</th><th style={th()}>Granted</th><th style={th()}>Expires</th><th style={th()}>State</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => {
                const active = r.revoked_at == null && new Date(r.expires_at).getTime() > now;
                const state = r.revoked_at != null ? 'revoked' : active ? 'active' : 'expired';
                return (
                  <tr key={r.id}>
                    <td style={td()}><Link href={`/admin/trading/kyc/${r.user_id}`} style={{ color: '#340075', fontWeight: 600, textDecoration: 'none' }}>{r.display_name}</Link><div style={{ fontSize: '0.7rem', color: '#9ca3af' }}><code>{r.user_id}</code></div></td>
                    <td style={td()}><span style={{ fontSize: '0.78rem' }}><code>{r.maker_id}</code> → <code>{r.checker_id}</code></span></td>
                    <td style={td()}><span style={{ maxWidth: 280, display: 'inline-block', color: '#4b5563' }}>{r.reason}</span></td>
                    <td style={td()}>{formatKobo(r.exposure_cap_kobo)}</td>
                    <td style={td()}>{fmtDate(r.granted_at)}</td>
                    <td style={td()}>{fmtDate(r.expires_at)}</td>
                    <td style={td()}><StatusBadge status={state === 'active' ? 'BYPASSED' : state === 'expired' ? 'EXPIRED' : 'REJECTED'} /><div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{state}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
