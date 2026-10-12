'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminListReviewSwaps, adminResolveReviewSwap, formatKobo } from '@/services/cryptoAdminService';
import type { CryptoReviewSwap, CryptoSwapResolveRequest } from '@/types/cryptoAdmin';
import {
  CryptoTabs, Kpi, StateBlock, DisclosureNote, AuditNote, PermissionBanner,
  mono, fmtDate, label as lbl, textarea, CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const PAGE_SIZE = 50;

type Decision = CryptoSwapResolveRequest['decision'];

// Parked money ages in seconds server-side; render it compactly (2h 15m, 3d 4h).
function fmtAge(seconds: number): string {
  if (!seconds || seconds < 0) return '—';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// The only safe action depends on whether the provider received the swap.
function actionFor(s: CryptoReviewSwap): Decision {
  return s.has_provider_id ? 'retry' : 'release';
}

export default function CryptoReviewQueuePage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);

  const [rows, setRows] = useState<CryptoReviewSwap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const [active, setActive] = useState<CryptoReviewSwap | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (off: number) => {
    setLoading(true); setError(null);
    try { setRows(await adminListReviewSwaps(PAGE_SIZE, off)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(offset); }, [offset, load]);

  const heldTotal = rows.reduce((a, s) => a + s.held_kobo, 0);
  const noProviderId = rows.filter((s) => !s.has_provider_id).length;

  const decision: Decision | null = active ? actionFor(active) : null;
  const noteMissing = !note.trim();

  function openDecision(s: CryptoReviewSwap) {
    setActive(s); setNote(''); setError(null); setMsg(null);
  }

  async function submit() {
    if (!active || !decision) return;
    if (noteMissing) { setError('An operator note is required.'); return; }
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await adminResolveReviewSwap(active.id, { decision, note: note.trim() });
      setMsg(
        decision === 'release'
          ? `Swap ${r.id} released — ${formatKobo(active.held_kobo)} returned to the user's wallet, swap marked ${r.status}. Note: "${note.trim()}"`
          : `Swap ${r.id} re-polled — provider outcome applied, status now ${r.status}. Note: "${note.trim()}"`,
      );
      setActive(null);
      await load(offset);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <PageHeader
        title="Crypto — Swap Review Queue"
        subtitle="Buy swaps the pipeline could not auto-resolve, parked in needs_review with the user's NGN still held in the ledger. Resolve each by releasing the hold or re-polling the provider."
        actions={<Button variant="outline" onClick={() => void load(offset)}>Refresh</Button>}
      />
      <CryptoTabs active="review" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/swaps/review</code> and{' '}
        <code>POST /api/v1/admin/crypto/swaps/:id/resolve</code> (RBAC <code>crypto.admin</code>), from the NEW
        provider-driven swap pipeline (table <code>crypto_swaps</code>) — distinct from the legacy Swaps tab. Each
        row&apos;s NGN (<code>held_kobo</code> = principal + fee) is held from the wallet. The safe resolution depends on
        provider state: a swap <strong>with</strong> a provider swap id is <strong>retried</strong> (re-poll, which
        settles or releases); a swap with <strong>no</strong> provider swap id has an unknown outcome and can only be{' '}
        <strong>released</strong> back to the user. There is no manual settle — we never credit crypto we cannot prove
        was bought. Every decision is audited.
      </DisclosureNote>

      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Parked swaps (page)" value={String(rows.length)} accent={rows.length ? colors.danger : undefined} />
        <Kpi label="NGN held" value={formatKobo(heldTotal)} accent={colors.primary} />
        <Kpi label="No provider id" value={String(noProviderId)} accent={noProviderId ? colors.danger : undefined} sub="outcome unknown — release only" />
      </div>

      {active && decision && (
        <Card title={`${decision === 'release' ? 'Release' : 'Retry'} swap ${active.id}`} style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem', fontSize: '0.82rem', marginBottom: '0.75rem', marginTop: 12 }}>
            <div><strong>User:</strong> <span style={mono()}>{active.user_id}</span></div>
            <div><strong>Asset:</strong> {active.asset}</div>
            <div><strong>NGN held:</strong> {formatKobo(active.held_kobo)}</div>
            <div><strong>Provider state:</strong> {active.has_provider_id ? <span style={mono()}>{active.provider_swap_id}</span> : <span style={{ color: colors.danger }}>no provider id</span>}</div>
          </div>
          <p style={{ fontSize: '0.8rem', color: colors.muted, marginBottom: '0.6rem' }}>
            {decision === 'release'
              ? `No provider swap id exists, so the provider never confirmed execution. Releasing reverses the ${formatKobo(active.held_kobo)} hold back to the user's wallet and marks the swap failed. Use only if you are satisfied the swap did not execute.`
              : `A provider swap id exists, so the provider received this swap. Retrying re-polls the provider and applies the authoritative outcome (it will settle the crypto or release the hold itself). Releasing is not offered here — it could pay the user back and still deliver the crypto.`}
          </p>
          <div>
            <label style={lbl()}>Operator note (mandatory — rationale, audited)</label>
            <textarea
              style={textarea()}
              placeholder={decision === 'release' ? 'e.g. Provider dashboard shows no swap executed; refunding user, ref ADR-...' : 'e.g. Webhook lost; re-polling provider to settle, ref ADR-...'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <Button variant="primary" disabled={!canAdmin || noteMissing || busy} onClick={() => void submit()}>
              {busy ? '…' : decision === 'release' ? 'Confirm release' : 'Confirm retry'}
            </Button>
            <Button variant="outline" onClick={() => setActive(null)}>Cancel</Button>
          </div>
          {noteMissing && <p style={{ color: colors.muted, fontSize: '0.75rem', marginTop: '0.4rem' }}>Submit is disabled until an operator note is entered.</p>}
        </Card>
      )}

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No swaps are parked for review. Held money is clear.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Swap</th><th style={thCell}>User</th><th style={thCell}>Asset</th>
              <th style={thCell}>NGN held</th><th style={thCell}>Provider state</th>
              <th style={thCell}>Parked for</th><th style={thCell}>Since</th><th style={thCell}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} style={!s.has_provider_id ? { background: tint(colors.danger, 0.08) } : undefined}>
                  <td style={{ ...tdCell, ...mono() }}>{s.id}</td>
                  <td style={{ ...tdCell, ...mono() }}>{s.user_id}</td>
                  <td style={tdCell}><strong>{s.asset}</strong></td>
                  <td style={tdCell}>{formatKobo(s.held_kobo)} <span style={{ color: colors.muted }}>({formatKobo(s.ngn_kobo)} + {formatKobo(s.fee_kobo)} fee)</span></td>
                  <td style={tdCell}>
                    {s.has_provider_id
                      ? <span style={mono()}>{s.provider_swap_id}</span>
                      : <span style={{ color: colors.danger, fontWeight: 600 }}>no provider id — outcome unknown</span>}
                  </td>
                  <td style={tdCell}>{fmtAge(s.age_seconds)}</td>
                  <td style={tdCell}>{fmtDate(s.updated_at)}</td>
                  <td style={{ ...tdCell, whiteSpace: 'nowrap' }}>
                    <Button variant="outline" sm disabled={!canAdmin} onClick={() => openDecision(s)}>
                      {s.has_provider_id ? 'Retry' : 'Release'}
                    </Button>
                  </td>
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
