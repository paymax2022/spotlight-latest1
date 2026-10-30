'use client';

import { useEffect, useState } from 'react';
import { getFees, setFees, USE_MOCK, USE_MOCK_ENV } from '@/services/eventsGovernanceAdminService';
import { formatNaira } from '@/services/eventsAdminService';
import type { FeeSettings } from '@/types/eventsGovernanceAdmin';
import { PageHeader, EventsTabs, Card, Kpi, DisclosureNote, StateBlock, AuditNote, btn, btnPrimary, input, label, fmtDate } from '../_ui';
import { FixtureBanner } from '../../_shared/ui';
import { colors } from '@/components/ui/vuexy';

const pctOf = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export default function FeesPage() {
  const [fees, setFeesState] = useState<FeeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { const f = await getFees(); setFeesState(f); setDraft(String(f.fee_bps)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const bps = Number(draft);
  const valid = draft.trim() !== '' && Number.isInteger(bps) && bps >= 0 && bps <= 10000;
  const changed = valid && fees !== null && bps !== fees.fee_bps;

  async function save() {
    if (!fees || !changed) return;
    if (!reason.trim()) { setMsg('A reason is required to change the platform fee.'); return; }
    if (!window.confirm(`Change the platform fee from ${pctOf(fees.fee_bps)} to ${pctOf(bps)}? This applies to new orders; existing orders and payouts keep the fee they were quoted. Audited.`)) return;
    setBusy(true); setMsg(null);
    try {
      const out = await setFees(bps, reason.trim());
      setFeesState(out); setDraft(String(out.fee_bps)); setReason('');
      setMsg(`Platform fee is now ${pctOf(out.fee_bps)}.`);
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Platform fee" subtitle="The events platform fee, in basis points (100 bps = 1%)." action={<button onClick={load} style={btn()} disabled={loading}>Refresh</button>} />
      <EventsTabs active="fees" />
      <FixtureBanner active={USE_MOCK} envVar={USE_MOCK_ENV} />
      <DisclosureNote>Refunds and payouts store the fee split on their own rows, so changing the fee never reprices an order a buyer has already been quoted.</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={error} empty={!fees}>
        {fees && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Current fee" value={pctOf(fees.fee_bps)} sub={`${fees.fee_bps} bps`} />
              <Kpi label="On a ₦10,000 ticket" value={formatNaira(Math.floor(1_000_000 * fees.fee_bps / 10000))} />
              <Kpi label="Last changed" value={fmtDate(fees.updated_at)} sub={fees.updated_by ? `by ${fees.updated_by}` : undefined} />
            </div>
            <Card title="Change fee">
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ width: 160 }}>
                  <label style={label()}>Fee (bps, 0–10000)</label>
                  <input style={input()} inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} />
                </div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <label style={label()}>Reason (required)</label>
                  <input style={input()} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <button style={btnPrimary()} disabled={busy || !changed || !reason.trim()} onClick={save}>{busy ? 'Saving…' : 'Save fee'}</button>
              </div>
              {!valid && <p style={{ color: colors.danger, fontSize: '0.78rem' }}>Enter a whole number from 0 to 10000.</p>}
              {changed && <p style={{ color: colors.muted, fontSize: '0.78rem' }}>New fee {pctOf(bps)} — {formatNaira(Math.floor(1_000_000 * bps / 10000))} on a ₦10,000 ticket.</p>}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
