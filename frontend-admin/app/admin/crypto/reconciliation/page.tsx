'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminGetReconciliation, formatKobo } from '@/services/cryptoAdminService';
import type { CryptoReconRow } from '@/types/cryptoAdmin';
import {
  PageHeader, CryptoTabs, Card, Kpi, StatusBadge, DisclosureNote, StateBlock, PermissionBanner,
  btn, th, td, fmtDate, fmtUnits,
  CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';

// Cash-equivalent of a signed drift in integer minor-units at the last quote.
// Integer math throughout: (drift × price_kobo) / minor_unit_scale, floored.
function driftKobo(row: CryptoReconRow): number {
  if (!row.minor_unit_scale) return 0;
  return Math.trunc((row.drift_units * row.price_kobo) / row.minor_unit_scale);
}

export default function CryptoReconciliationPage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);

  const [rows, setRows] = useState<CryptoReconRow[]>([]);
  const [asOf, setAsOf] = useState<string>('');
  const [breaks, setBreaks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const s = await adminGetReconciliation();
      setRows(s.rows); setBreaks(s.breaks); setAsOf(s.as_of);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const netDriftKobo = rows.reduce((a, r) => a + driftKobo(r), 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Crypto — Reconciliation"
        subtitle="Per-asset comparison of the on-chain custodial balance against the summed holding projections in the finance ledger. Any non-zero drift is a break to investigate — following the FX SF-8 reconciliation pattern."
        action={<button onClick={() => void load()} style={btn()}>Refresh</button>}
      />
      <CryptoTabs active="reconciliation" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/reconciliation</code> (RBAC <code>crypto.admin</code>). Ledger units
        are the authoritative Σ of holding projections (never edited to match the chain). Drift is surfaced, not
        absorbed: a positive drift means the chain holds more than the ledger records; negative means a shortfall to
        chase. Cash-equivalent drift uses the last quote and integer math only.
      </DisclosureNote>

      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Assets reconciled" value={String(rows.length)} />
        <Kpi label="Breaks (drift ≠ 0)" value={String(breaks)} accent={breaks ? '#b91c1c' : '#15803d'} />
        <Kpi label="Net cash-equiv drift" value={formatKobo(netDriftKobo)} accent={netDriftKobo !== 0 ? '#b91c1c' : '#15803d'} />
        <Kpi label="As of" value={asOf ? fmtDate(asOf) : '—'} />
      </div>

      <Card title="Per-asset drift">
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No assets to reconcile.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Asset</th><th style={th()}>Ledger units</th><th style={th()}>On-chain units</th>
              <th style={th()}>Drift (units)</th><th style={th()}>Drift (cash equiv)</th>
              <th style={th()}>Status</th><th style={th()}>Last checked</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const dk = driftKobo(r);
                const noFeed = r.status === 'no_feed';
                const isBreak = !noFeed && (r.status === 'break' || r.status === 'drift' || r.drift_units !== 0);
                return (
                  <tr key={r.asset_id} style={isBreak ? { background: '#fef2f2' } : noFeed ? { background: '#fffbeb' } : undefined}>
                    <td style={{ ...td(), fontWeight: 700 }}>{r.symbol}</td>
                    <td style={td()}>{fmtUnits(r.ledger_units, r.minor_unit_scale, r.symbol)}</td>
                    <td style={td()}>{fmtUnits(r.onchain_units, r.minor_unit_scale, r.symbol)}</td>
                    <td style={{ ...td(), color: r.drift_units === 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                      {r.drift_units > 0 ? '+' : ''}{fmtUnits(r.drift_units, r.minor_unit_scale, r.symbol)}
                    </td>
                    <td style={{ ...td(), color: dk === 0 ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                      {dk > 0 ? '+' : dk < 0 ? '-' : ''}{formatKobo(Math.abs(dk))}
                    </td>
                    <td style={td()}><StatusBadge status={noFeed ? 'no_feed' : isBreak ? 'break' : 'ok'} /></td>
                    <td style={td()}>{fmtDate(r.last_checked_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StateBlock>
        <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.75rem' }}>
          Breaks are queued for investigation, never resolved by editing the ledger. Corrections to the ledger, if
          warranted, happen only via reversing double-entry postings on the money path — never a direct balance edit.
        </p>
      </Card>
    </div>
  );
}
