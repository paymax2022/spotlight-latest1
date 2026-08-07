'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminListWithdrawals, adminDecideWithdrawal, formatKobo } from '@/services/cryptoAdminService';
import type { CryptoWithdrawal } from '@/types/cryptoAdmin';
import {
  CryptoTabs, StatusBadge, RiskBadge, FlagPill, DisclosureNote, StateBlock,
  AuditNote, PermissionBanner, mono, fmtDate, fmtUnits,
  FilterBar, label as lbl, select, textarea,
  CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const PAGE_SIZE = 50;

// Minor-unit scale per symbol (mirrors the catalogue; used for display only).
const SCALE: Record<string, number> = { BTC: 100_000_000, ETH: 1_000_000_000, USDT: 1_000_000 };

export default function CryptoWithdrawalsPage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);

  const [rows, setRows] = useState<CryptoWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [offset, setOffset] = useState(0);

  // Decision drawer state.
  const [active, setActive] = useState<CryptoWithdrawal | null>(null);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (off: number, status: string) => {
    setLoading(true); setError(null);
    try { setRows(await adminListWithdrawals(status, PAGE_SIZE, off)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(offset, statusFilter); }, [offset, statusFilter, load]);

  function openDecision(w: CryptoWithdrawal, d: 'approve' | 'reject') {
    setActive(w); setDecision(d); setNote(''); setError(null); setMsg(null);
  }

  const noteMissing = !note.trim();

  async function submit() {
    if (!active) return;
    if (noteMissing) { setError('An operator note is required.'); return; }
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await adminDecideWithdrawal(active.id, { decision, note: note.trim() });
      setMsg(`Withdrawal ${r.id} ${decision === 'approve' ? 'approved → pending broadcast' : 'rejected → failed (parked units returned)'}. Note: "${note.trim()}"`);
      setActive(null);
      await load(offset, statusFilter);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const pending = rows.filter((w) => w.status === 'pending_review');

  return (
    <Page>
      <PageHeader
        title="Crypto — Withdrawals / AML"
        subtitle="AML review queue for outbound crypto withdrawals. Approve moves pending_review → approved (accepted for broadcast); reject moves pending_review → failed and returns the parked holding units. Funds never leave before approval. Both transitions are audited."
        actions={<Button variant="outline" onClick={() => void load(offset, statusFilter)}>Refresh</Button>}
      />
      <CryptoTabs active="withdrawals" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/withdrawals</code> and{' '}
        <code>POST /api/v1/admin/crypto/withdrawals/:id/decision</code> (RBAC <code>crypto.admin</code>). Withdrawals
        follow the guarded state machine <code>requested → pending_review → approved → broadcast → confirmed | failed</code> —
        funds never leave before an admin approval (member requests park at pending_review). Units are integer asset
        minor-units; cash equivalents are NGN kobo. No status is mutated outside the state machine.
      </DisclosureNote>

      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Card style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>Awaiting decision</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: pending.length ? colors.warning : colors.text }}>{pending.length}</div>
        </Card>
        <Card style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>High-risk (score ≥ 70)</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: colors.danger }}>{rows.filter((w) => (w.aml_score ?? 0) >= 70).length}</div>
        </Card>
      </div>

      {active && (
        <Card title={`${decision === 'approve' ? 'Approve' : 'Reject'} withdrawal ${active.id}`} style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem', fontSize: '0.82rem', marginBottom: '0.75rem', marginTop: 12 }}>
            <div><strong>User:</strong> <span style={mono()}>{active.user_id}</span></div>
            <div><strong>Asset:</strong> {active.symbol ?? active.asset_id}</div>
            <div><strong>Amount:</strong> {fmtUnits(active.units, SCALE[active.symbol ?? ''] ?? 0, active.symbol)}</div>
            <div><strong>Cash equiv:</strong> {formatKobo(active.value_kobo)}</div>
            <div style={{ gridColumn: '1 / -1' }}><strong>Destination:</strong> <span style={mono()}>{active.address}</span> ({active.network})</div>
            <div style={{ gridColumn: '1 / -1' }}><strong>AML score:</strong> <RiskBadge score={active.aml_score} /> {(active.aml_flags ?? []).map((f) => <FlagPill key={f}>{f}</FlagPill>)}</div>
          </div>
          <div>
            <label style={lbl()}>Operator note (mandatory — rationale for this decision)</label>
            <textarea
              style={textarea()}
              placeholder={decision === 'approve' ? 'e.g. AML review passed, destination whitelisted, ref AML-2026-...' : 'e.g. Sanctioned-address hit; escalated to compliance, ticket AML-2026-...'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <Button
              variant="primary"
              disabled={!canAdmin || noteMissing || busy}
              onClick={() => void submit()}
            >{busy ? '…' : decision === 'approve' ? 'Confirm approve' : 'Confirm reject'}</Button>
            <Button variant="outline" onClick={() => setActive(null)}>Cancel</Button>
          </div>
          {noteMissing && <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: '0.4rem' }}>Submit is disabled until an operator note is entered.</p>}
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: 14 }}>
          <FilterBar>
            <div>
              <label style={lbl()}>Status</label>
              <select style={select()} value={statusFilter} onChange={(e) => { setOffset(0); setStatusFilter(e.target.value); }}>
                <option value="">All</option>
                <option value="pending_review">Pending review (awaiting AML decision)</option>
                <option value="approved">Approved (accepted for broadcast)</option>
                <option value="requested">Requested (legacy)</option>
                <option value="broadcast">Broadcast</option>
                <option value="confirmed">Confirmed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </FilterBar>
        </div>

        <div style={{ padding: rows.length === 0 || loading ? '0 14px 14px' : 0 }}>
          <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No withdrawals match this filter.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Withdrawal</th><th style={thCell}>User</th><th style={thCell}>Asset</th>
                <th style={thCell}>Amount</th><th style={thCell}>Cash equiv</th><th style={thCell}>Destination</th>
                <th style={thCell}>Risk</th><th style={thCell}>Flags</th><th style={thCell}>Status</th>
                <th style={thCell}>Requested</th><th style={thCell}>Action</th>
              </tr></thead>
              <tbody>
                {rows.map((w) => {
                  const scale = SCALE[w.symbol ?? ''] ?? 0;
                  const decidable = w.status === 'pending_review';
                  return (
                    <tr key={w.id}>
                      <td style={{ ...tdCell, ...mono() }}>{w.id}</td>
                      <td style={{ ...tdCell, ...mono() }}>{w.user_id}</td>
                      <td style={tdCell}>{w.symbol ?? w.asset_id}</td>
                      <td style={tdCell}>{fmtUnits(w.units, scale, w.symbol)}</td>
                      <td style={tdCell}>{formatKobo(w.value_kobo)}</td>
                      <td style={{ ...tdCell, ...mono(), maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.address}>{w.address ?? '—'}</td>
                      <td style={tdCell}><RiskBadge score={w.aml_score} /></td>
                      <td style={{ ...tdCell, maxWidth: 200 }}>{(w.aml_flags ?? []).length ? (w.aml_flags ?? []).map((f) => <FlagPill key={f}>{f}</FlagPill>) : <span style={{ color: colors.muted }}>—</span>}</td>
                      <td style={tdCell}><StatusBadge status={w.status} /></td>
                      <td style={tdCell}>{fmtDate(w.created_at)}</td>
                      <td style={{ ...tdCell, whiteSpace: 'nowrap' }}>
                        {decidable ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Button variant="outline" sm disabled={!canAdmin} onClick={() => openDecision(w, 'approve')}>Approve</Button>
                            <Button variant="outline" sm disabled={!canAdmin} onClick={() => openDecision(w, 'reject')}>Reject</Button>
                          </div>
                        ) : <span style={{ color: colors.muted }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </StateBlock>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', padding: '0 14px 14px', justifyContent: 'flex-end' }}>
          <Button variant="outline" sm disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
          <Button variant="outline" sm disabled={rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
        </div>
      </Card>
    </Page>
  );
}
