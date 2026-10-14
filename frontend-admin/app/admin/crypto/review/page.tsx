'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminListReviewSwaps, formatKobo } from '@/services/cryptoAdminService';
import type { CryptoReviewSwap } from '@/types/cryptoAdmin';
import {
  CryptoTabs, Kpi, StateBlock, DisclosureNote, PermissionBanner,
  mono, fmtDate, CRYPTO_PERMS, useCryptoPermission,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

const PAGE_SIZE = 50;

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

export default function CryptoReviewQueuePage() {
  const { allowed: canAdmin } = useCryptoPermission(CRYPTO_PERMS.admin);

  const [rows, setRows] = useState<CryptoReviewSwap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async (off: number) => {
    setLoading(true); setError(null);
    try { setRows(await adminListReviewSwaps(PAGE_SIZE, off)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(offset); }, [offset, load]);

  const heldTotal = rows.reduce((a, s) => a + s.held_kobo, 0);
  const noProviderId = rows.filter((s) => !s.has_provider_id).length;

  return (
    <Page>
      <PageHeader
        title="Crypto — Swap Review Queue"
        subtitle="Buy swaps the pipeline could not auto-resolve, parked in needs_review with the user's NGN still held in the ledger. Read-only oversight — settle/release/retry decision controls are a follow-up."
        actions={<Button variant="outline" onClick={() => void load(offset)}>Refresh</Button>}
      />
      <CryptoTabs active="review" />
      <DisclosureNote>
        Backed by <code>GET /api/v1/admin/crypto/swaps/review</code> (RBAC <code>crypto.admin</code>), from the NEW
        provider-driven swap pipeline (table <code>crypto_swaps</code>) — distinct from the legacy Swaps tab
        (<code>crypto_swap_orders</code>). Each row&apos;s NGN (<code>held_kobo</code> = principal + fee) is held from the
        wallet; the swap is awaiting a settlement that never arrived. A row with <strong>no provider swap id</strong> has
        an unknown provider outcome and must never be blindly settled — only a release is safe there.
      </DisclosureNote>

      {!canAdmin && <PermissionBanner permission={CRYPTO_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Parked swaps (page)" value={String(rows.length)} accent={rows.length ? colors.danger : undefined} />
        <Kpi label="NGN held" value={formatKobo(heldTotal)} accent={colors.primary} />
        <Kpi label="No provider id" value={String(noProviderId)} accent={noProviderId ? colors.danger : undefined} sub="outcome unknown — release only" />
      </div>

      <Card>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No swaps are parked for review. Held money is clear.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Swap</th><th style={thCell}>User</th><th style={thCell}>Asset</th>
              <th style={thCell}>NGN held</th><th style={thCell}>Provider state</th>
              <th style={thCell}>Parked for</th><th style={thCell}>Since</th>
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
