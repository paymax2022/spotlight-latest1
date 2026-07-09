'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminListWithdrawals, adminDecideWithdrawal, formatKobo } from '@/services/cryptoAdminService';
import type { CryptoWithdrawal } from '@/types/cryptoAdmin';
import {
  PageHeader, CryptoTabs, Card, StatusBadge, RiskBadge, FlagPill, DisclosureNote, StateBlock,
  AuditNote, PermissionBanner, btn, btnPrimary, btnDisabled, th, td, mono, fmtDate, fmtUnits,
  FilterBar, label as lbl, select, textarea,
  CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';

const PAGE_SIZE = 50;

// Minor-unit scale per symbol (mirrors the catalogue; used for display only).
const SCALE: Record<string, number> = { BTC: 100_000_000, ETH: 1_000_000_000, USDT: 1_000_000 };

export default function CryptoWithdrawalsPage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);

  const [rows, setRows] = useState<CryptoWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
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

  const pending = rows.filter((w) => w.status === 'requested');

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Crypto — Withdrawals / AML"
        subtitle="Approval queue for outbound crypto withdrawals. Approve moves requested → pending (accepted for broadcast); reject moves requested → failed and returns the parked holding units. Both transitions are audited."
        action={<button onClick={() => void load(offset, statusFilter)} style={btn()}>Refresh</button>}
      />
      <CryptoTabs active="withdrawals" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/withdrawals</code> and{' '}
        <code>POST /api/v1/admin/crypto/withdrawals/:id/decision</code> (RBAC <code>crypto.admin</code>). Withdrawals
        follow the guarded state machine <code>requested → pending → broadcast → confirmed | failed</code> — the queue
        only drives the first hop. Units are integer asset minor-units; cash equivalents are NGN kobo. No status is
        mutated outside the state machine.
      </DisclosureNote>

      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.85rem 1rem', background: '#fff' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>Awaiting decision</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: pending.length ? '#9a3412' : '#111827' }}>{pending.length}</div>
        </div>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.85rem 1rem', background: '#fff' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600 }}>High-risk (score ≥ 70)</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: '#b91c1c' }}>{rows.filter((w) => (w.aml_score ?? 0) >= 70).length}</div>
        </div>
      </div>

      {active && (
        <Card title={`${decision === 'approve' ? 'Approve' : 'Reject'} withdrawal ${active.id}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
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
            <button
              style={canAdmin && !noteMissing && !busy ? btnPrimary() : btnDisabled()}
              disabled={!canAdmin || noteMissing || busy}
              onClick={() => void submit()}
            >{busy ? '…' : decision === 'approve' ? 'Confirm approve' : 'Confirm reject'}</button>
            <button style={btn()} onClick={() => setActive(null)}>Cancel</button>
          </div>
          {noteMissing && <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.4rem' }}>Submit is disabled until an operator note is entered.</p>}
        </Card>
      )}

      <Card>
        <FilterBar>
          <div>
            <label style={lbl()}>Status</label>
            <select style={select()} value={statusFilter} onChange={(e) => { setOffset(0); setStatusFilter(e.target.value); }}>
              <option value="">All</option>
              <option value="requested">Requested (awaiting decision)</option>
              <option value="pending">Pending</option>
              <option value="broadcast">Broadcast</option>
              <option value="confirmed">Confirmed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </FilterBar>

        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No withdrawals match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Withdrawal</th><th style={th()}>User</th><th style={th()}>Asset</th>
              <th style={th()}>Amount</th><th style={th()}>Cash equiv</th><th style={th()}>Destination</th>
              <th style={th()}>Risk</th><th style={th()}>Flags</th><th style={th()}>Status</th>
              <th style={th()}>Requested</th><th style={th()}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((w) => {
                const scale = SCALE[w.symbol ?? ''] ?? 0;
                const decidable = w.status === 'requested';
                return (
                  <tr key={w.id}>
                    <td style={{ ...td(), ...mono() }}>{w.id}</td>
                    <td style={{ ...td(), ...mono() }}>{w.user_id}</td>
                    <td style={td()}>{w.symbol ?? w.asset_id}</td>
                    <td style={td()}>{fmtUnits(w.units, scale, w.symbol)}</td>
                    <td style={td()}>{formatKobo(w.value_kobo)}</td>
                    <td style={{ ...td(), ...mono(), maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.address}>{w.address ?? '—'}</td>
                    <td style={td()}><RiskBadge score={w.aml_score} /></td>
                    <td style={{ ...td(), maxWidth: 200 }}>{(w.aml_flags ?? []).length ? (w.aml_flags ?? []).map((f) => <FlagPill key={f}>{f}</FlagPill>) : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                    <td style={td()}><StatusBadge status={w.status} /></td>
                    <td style={td()}>{fmtDate(w.created_at)}</td>
                    <td style={{ ...td(), whiteSpace: 'nowrap' }}>
                      {decidable ? (
                        <>
                          <button style={{ ...(canAdmin ? btn() : btnDisabled()), marginRight: 6 }} disabled={!canAdmin} onClick={() => openDecision(w, 'approve')}>Approve</button>
                          <button style={canAdmin ? btn() : btnDisabled()} disabled={!canAdmin} onClick={() => openDecision(w, 'reject')}>Reject</button>
                        </>
                      ) : <span style={{ color: '#9ca3af' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StateBlock>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button style={btn()} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
          <button style={btn()} disabled={rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
        </div>
      </Card>
    </div>
  );
}
