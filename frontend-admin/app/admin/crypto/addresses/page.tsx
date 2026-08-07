'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminListAddresses, adminDecideAddress } from '@/services/cryptoAdminService';
import type { CryptoAddress } from '@/types/cryptoAdmin';
import {
  CryptoTabs, DisclosureNote, AuditNote, StateBlock, StatusBadge,
  PermissionBanner, mono, fmtDate,
  FilterBar, label as lbl, select, textarea,
  CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

export default function CryptoAddressesPage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);

  const [rows, setRows] = useState<CryptoAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState('');

  const [active, setActive] = useState<CryptoAddress | null>(null);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (review: string) => {
    setLoading(true); setError(null);
    try { setRows(await adminListAddresses(review)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(reviewFilter); }, [reviewFilter, load]);

  function openDecision(a: CryptoAddress, d: 'approve' | 'reject') {
    setActive(a); setDecision(d); setNote(''); setError(null); setMsg(null);
  }

  const noteMissing = !note.trim();

  async function submit() {
    if (!active) return;
    if (noteMissing) { setError('An operator note is required.'); return; }
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await adminDecideAddress(active.id, { decision, note: note.trim() });
      setMsg(`Address ${r.id} (${r.label}) ${decision === 'approve' ? 'approved — now allow-listed for withdrawals' : 'rejected — cannot be used as a destination'}. Note: "${note.trim()}"`);
      setActive(null);
      await load(reviewFilter);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const pendingCount = rows.filter((a) => a.review_status === 'pending').length;

  return (
    <Page>
      <PageHeader
        title="Crypto — Address Allow-list Review"
        subtitle="Whitelisted withdrawal destinations awaiting compliance review. Approving allow-lists an address for outbound withdrawals; rejecting blocks it. Screening verdicts (sanction/mixer exposure) are surfaced per row."
        actions={<Button variant="outline" onClick={() => void load(reviewFilter)}>Refresh</Button>}
      />
      <CryptoTabs active="addresses" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/addresses</code> and{' '}
        <code>POST /api/v1/admin/crypto/addresses/:id/decision</code> (RBAC <code>crypto.admin</code>). Members add
        candidate addresses via <code>POST /api/v1/crypto/addresses</code> (screened on save); only allow-listed
        addresses can be withdrawal destinations. Every decision is audited.
      </DisclosureNote>

      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Card style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600 }}>Awaiting review</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.25rem', color: pendingCount ? colors.warning : colors.text }}>{pendingCount}</div>
        </Card>
      </div>

      {active && (
        <Card title={`${decision === 'approve' ? 'Approve' : 'Reject'} address ${active.id}`} style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem', fontSize: '0.82rem', marginBottom: '0.75rem', marginTop: 12 }}>
            <div><strong>User:</strong> <span style={mono()}>{active.user_id}</span></div>
            <div><strong>Label:</strong> {active.label}</div>
            <div><strong>Asset / network:</strong> {active.symbol ?? active.asset_id} · {active.network}</div>
            <div style={{ gridColumn: '1 / -1' }}><strong>Address:</strong> <span style={mono()}>{active.address}</span></div>
            <div style={{ gridColumn: '1 / -1' }}><strong>Screening:</strong> <span style={{ color: (active.screening_result ?? '').startsWith('flagged') ? colors.danger : colors.success }}>{active.screening_result ?? '—'}</span></div>
          </div>
          <div>
            <label style={lbl()}>Operator note (mandatory — rationale for this decision)</label>
            <textarea
              style={textarea()}
              placeholder={decision === 'approve' ? 'e.g. Screening clean, ownership attested, ref ADR-2026-...' : 'e.g. Screening flagged mixer exposure; declined per policy, ref ADR-2026-...'}
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
              <label style={lbl()}>Review status</label>
              <select style={select()} value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}>
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </FilterBar>
        </div>

        <div style={{ padding: rows.length === 0 || loading || error ? '0 14px 14px' : 0 }}>
          <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No addresses match this filter.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Label</th><th style={thCell}>User</th><th style={thCell}>Asset</th><th style={thCell}>Network</th>
                <th style={thCell}>Address</th><th style={thCell}>Screening</th><th style={thCell}>Review</th>
                <th style={thCell}>Added</th><th style={thCell}>Action</th>
              </tr></thead>
              <tbody>
                {rows.map((a) => {
                  const flagged = (a.screening_result ?? '').startsWith('flagged');
                  const decidable = a.review_status === 'pending';
                  return (
                    <tr key={a.id}>
                      <td style={{ ...tdCell, fontWeight: 600 }}>{a.label}</td>
                      <td style={{ ...tdCell, ...mono() }}>{a.user_id}</td>
                      <td style={tdCell}>{a.symbol ?? a.asset_id}</td>
                      <td style={tdCell}>{a.network}</td>
                      <td style={{ ...tdCell, ...mono(), maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.address}>{a.address}</td>
                      <td style={{ ...tdCell, color: flagged ? colors.danger : colors.success, maxWidth: 220 }}>{a.screening_result ?? '—'}</td>
                      <td style={tdCell}><StatusBadge status={a.review_status} /></td>
                      <td style={tdCell}>{fmtDate(a.created_at)}</td>
                      <td style={{ ...tdCell, whiteSpace: 'nowrap' }}>
                        {decidable ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Button variant="outline" sm disabled={!canAdmin} onClick={() => openDecision(a, 'approve')}>Approve</Button>
                            <Button variant="outline" sm disabled={!canAdmin} onClick={() => openDecision(a, 'reject')}>Reject</Button>
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
      </Card>
    </Page>
  );
}
