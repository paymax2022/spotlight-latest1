'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminListDeposits, adminGetDepositReconcilerStatus } from '@/services/cryptoAdminService';
import type { CryptoDeposit, CryptoDepositReconcilerStatus } from '@/types/cryptoAdmin';
import {
  CryptoTabs, Kpi, DisclosureNote, StateBlock, PermissionBanner,
  mono, fmtDate, fmtUnits, FilterBar, label as lbl, select,
  CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const PAGE_SIZE = 50;

export default function CryptoDepositsPage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);

  const [rows, setRows] = useState<CryptoDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [symbol, setSymbol] = useState('');
  const [recon, setRecon] = useState<CryptoDepositReconcilerStatus | null>(null);

  const load = useCallback(async (off: number, sym: string) => {
    setLoading(true); setError(null);
    try {
      const [deps, status] = await Promise.all([adminListDeposits(PAGE_SIZE, off, sym), adminGetDepositReconcilerStatus()]);
      setRows(deps); setRecon(status);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(offset, symbol); }, [offset, symbol, load]);

  const symbols = Array.from(new Set(rows.map((d) => d.symbol))).sort();
  const totals = rows.reduce<Record<string, { units: number; scale: number }>>((acc, d) => {
    const e = acc[d.symbol] ?? { units: 0, scale: d.minor_unit_scale };
    e.units += d.units; acc[d.symbol] = e; return acc;
  }, {});

  return (
    <Page>
      <PageHeader
        title="Crypto — Deposits (money-IN)"
        subtitle="Settled inbound crypto credits across all users. A row appears only once a transfer reached its confirmation floor and was credited exactly once — so this is money-IN history. Read-only."
        actions={<Button variant="outline" onClick={() => void load(offset, symbol)}>Refresh</Button>}
      />
      <CryptoTabs active="deposits" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/deposits</code> (RBAC <code>crypto.admin</code>, table
        <code> crypto_deposits</code>). The credit is owned by the customer whose mapped deposit address the transfer hit
        (resolved server-side from <code>crypto_accounts</code>, never trusted from a webhook), applied once via a unique
        provider operation id. Transfers still awaiting confirmations, or unmapped to any customer, are NOT credited and
        are not listed here — that exception queue is a separate design. The <b>Deposit reconciler</b> safety net
        re-sweeps the provider deposit list and re-submits each transfer into the same once-only settler, so a missed or
        late webhook can never double-credit.
      </DisclosureNote>

      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {recon && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <Kpi label="Deposit sweeps (led)" value={String(recon.replica.led_runs)} />
          <Kpi label="Settled (total)" value={String(recon.replica.totals.settled)} accent={colors.success} />
          <Kpi label="Duplicates" value={String(recon.replica.totals.duplicates)} />
          <Kpi label="Awaiting confs" value={String(recon.replica.totals.awaiting)} accent={recon.replica.totals.awaiting ? colors.warning : undefined} />
          <Kpi label="Sweep errors" value={String(recon.replica.totals.errors)} accent={recon.replica.totals.errors ? colors.danger : undefined} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Credits (recent page)" value={String(rows.length)} />
        {Object.entries(totals).map(([sym, t]) => (
          <Kpi key={sym} label={`Credited ${sym}`} value={fmtUnits(t.units, t.scale, sym)} accent={colors.primary} />
        ))}
      </div>

      <Card>
        <FilterBar>
          <div>
            <label style={lbl()}>Asset</label>
            <select style={select()} value={symbol} onChange={(e) => { setSymbol(e.target.value); setOffset(0); }}>
              <option value="">All assets</option>
              {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </FilterBar>

        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No settled deposits yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Credit</th><th style={thCell}>User</th><th style={thCell}>Asset</th>
              <th style={thCell}>Amount</th><th style={thCell}>Confirmations</th><th style={thCell}>Provider op</th>
              <th style={thCell}>Tx</th><th style={thCell}>Credited</th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td style={{ ...tdCell, ...mono() }}>{d.id}</td>
                  <td style={{ ...tdCell, ...mono() }}>{d.user_id}</td>
                  <td style={tdCell}><strong>{d.symbol}</strong> <span style={{ color: colors.muted }}>{d.network}</span></td>
                  <td style={tdCell}>{fmtUnits(d.units, d.minor_unit_scale, d.symbol)}</td>
                  <td style={tdCell}>{d.confirmations}/{d.required_confs}</td>
                  <td style={{ ...tdCell, ...mono() }}>{d.provider_op_id}</td>
                  <td style={{ ...tdCell, ...mono(), maxWidth: 160 }}>{d.tx_hash || <span style={{ color: colors.muted }}>—</span>}</td>
                  <td style={tdCell}>{fmtDate(d.credited_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <Button variant="outline" sm disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
          <Button variant="outline" sm disabled={rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
        </div>
      </Card>
    </Page>
  );
}
