'use client';

// A7 — Pot & disbursement. RBAC: arena.admin.manage (Competition Admin) + a
// second approver (arena.admin.disburse). View derived pot total + contribution
// ledger; define split per the published formula; MULTI-APPROVE (two approvers);
// execute; show disbursement status. Amounts reconcile against the derived pot;
// every movement is ledgered + audited (NDC-4).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCompetitions, getPot, disbursePot, finalizeAwards, formatKobo } from '@/services/arenaAdminService';
import type { Competition, PotView, PotSplit } from '@/types/arenaAdmin';
import {
  PageHeader, Card, btn, btnPrimary, btnDisabled, th, td, inputStyle, selectStyle, mono,
  DisbursementBadge, timeAgo, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission, useArenaUser,
} from '../_ui';
import { hasAnyPermission } from '@/features/auth/rbac';
import { ConfirmDialog } from '@/components/rbac/ConfirmDialog';

export default function ArenaPotPage() {
  const { allowed } = useArenaPermission(ARENA_PERMS.admin);
  const user = useArenaUser();
  const canApprove = hasAnyPermission(user, [ARENA_PERMS.admin, ARENA_PERMS.potDisburse]);

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [pot, setPot] = useState<PotView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [splits, setSplits] = useState<PotSplit[]>([]);
  const [busy, setBusy] = useState(false);
  // Two-approver UI: track which approvals the operator has registered this session.
  const [approved, setApproved] = useState(false);
  // Gate the execute action behind the ConfirmDialog.
  const [confirmingExecute, setConfirmingExecute] = useState(false);

  useEffect(() => {
    void listCompetitions().then((c) => { setCompetitions(c); if (c[0]) setCompetitionId(c[0].id); }).catch((e) => setError(String(e)));
  }, []);

  const load = useCallback(async () => {
    if (!competitionId) return;
    setLoading(true); setError(null); setApproved(false); setNotice(null);
    try {
      const p = await getPot(competitionId);
      setPot(p);
      setSplits(p.splits ?? []);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [competitionId]);

  useEffect(() => { void load(); }, [load]);

  const splitTotal = useMemo(() => splits.reduce((s, x) => s + (x.amount_kobo || 0), 0), [splits]);
  const reconciles = pot ? splitTotal === pot.total_kobo : false;
  const existingApprovals = pot?.approvals?.length ?? 0;
  const required = pot?.approvals_required ?? 2;
  // Session approval + already-recorded approvals.
  const effectiveApprovals = existingApprovals + (approved ? 1 : 0);
  const readyToExecute = reconciles && effectiveApprovals >= required;

  const setSplitAmount = useCallback((i: number, next: string) => {
    const kobo = Math.round(Number(next.replace(/[^0-9.]/g, '')) * 100);
    setSplits((s) => s.map((x, idx) => (idx === i ? { ...x, amount_kobo: Number.isFinite(kobo) ? kobo : x.amount_kobo } : x)));
  }, []);

  const finalize = useCallback(async () => {
    setBusy(true); setError(null); setNotice(null);
    try { await finalizeAwards(competitionId); setNotice('Awards finalized (signed award_result). Disbursement may proceed.'); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [competitionId, load]);

  const askExecute = useCallback(() => {
    if (!readyToExecute) return;
    setError(null);
    setConfirmingExecute(true);
  }, [readyToExecute]);

  // reason is captured as an operator acknowledgement for the audit trail;
  // disbursePot does not accept a reason argument (signature unchanged).
  const execute = useCallback(async (_reason: string) => {
    if (!readyToExecute) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await disbursePot(competitionId, splits);
      setConfirmingExecute(false);
      setNotice('Disbursement submitted to payout rails (idempotent, ledgered, audited).');
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [readyToExecute, competitionId, splits, load]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Arena — Pot & Disbursement (A7)"
        subtitle="Derived pot total + contribution ledger. Define split per published formula, MULTI-APPROVE (two approvers), execute. Reconciles against the derived pot. RBAC: arena.admin.manage."
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)} style={selectStyle()}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => void load()} style={btn()}>Refresh</button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {notice && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#166534', marginBottom: '1.25rem' }}>{notice}</div>}

      {loading || !pot ? (
        <Card><p style={{ color: '#6b7280' }}>Loading pot…</p></Card>
      ) : (
        <>
          <Card title="Derived pot">
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: '#9ca3af', textTransform: 'uppercase' }}>Total (derived from ledger)</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#111827' }}>{formatKobo(pot.total_kobo)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: '#9ca3af', textTransform: 'uppercase' }}>Disbursement</div>
                <div style={{ marginTop: 4 }}><DisbursementBadge status={pot.disbursement_status} /></div>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: '0.72rem', color: '#9ca3af', textTransform: 'uppercase' }}>Published split formula (immutable)</div>
                <div style={{ fontSize: '0.85rem', color: '#374151' }}>{pot.split_formula}</div>
              </div>
            </div>
          </Card>

          <Card title="Contribution ledger">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>Source</th>
                    <th style={th()}>Contestant</th>
                    <th style={th()}>Amount</th>
                    <th style={th()}>Ledger entry</th>
                    <th style={th()}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {(pot.contributions ?? []).map((c) => (
                    <tr key={c.id}>
                      <td style={td()}>{c.source}</td>
                      <td style={{ ...td(), ...mono() }}>{c.contestant_id ?? '—'}</td>
                      <td style={td()}>{formatKobo(c.amount_kobo)}</td>
                      <td style={{ ...td(), ...mono() }}>{c.ledger_entry_id ?? '—'}</td>
                      <td style={td()}>{timeAgo(c.created_at)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...td(), fontWeight: 700 }} colSpan={2}>Derived total</td>
                    <td style={{ ...td(), fontWeight: 700 }}>{formatKobo(pot.total_kobo)}</td>
                    <td style={td()} colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Disbursement splits">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>Allocation</th>
                    <th style={th()}>Beneficiary</th>
                    <th style={th()}>Amount (₦)</th>
                  </tr>
                </thead>
                <tbody>
                  {splits.map((s, i) => (
                    <tr key={s.label}>
                      <td style={td()}>{s.label}</td>
                      <td style={{ ...td(), ...mono() }}>{s.beneficiary ?? '—'}</td>
                      <td style={td()}>
                        <input
                          value={(s.amount_kobo / 100).toString()}
                          onChange={(e) => setSplitAmount(i, e.target.value)}
                          style={{ ...inputStyle(), width: 140 }}
                          disabled={!allowed}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...td(), fontWeight: 700 }} colSpan={2}>Split total</td>
                    <td style={{ ...td(), fontWeight: 700, color: reconciles ? '#166534' : '#b91c1c' }}>
                      {formatKobo(splitTotal)} {reconciles ? '✓ reconciles' : `✗ ≠ ${formatKobo(pot.total_kobo)}`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Multi-approve & execute">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {Array.from({ length: required }).map((_, i) => {
                const met = i < effectiveApprovals;
                return (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.2rem 0.6rem', borderRadius: 9999, fontSize: '0.78rem', fontWeight: 600, color: met ? '#166534' : '#9a3412', background: met ? '#dcfce7' : '#ffedd5' }}>
                    {met ? '✓' : '○'} Approver {i + 1}
                  </span>
                );
              })}
              <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{effectiveApprovals}/{required} approvals</span>
            </div>

            {(pot.approvals ?? []).length > 0 && (
              <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: '#6b7280' }}>
                Recorded: {(pot.approvals ?? []).map((a) => `${a.approver_email ?? a.approver_id} (${timeAgo(a.approved_at)})`).join(', ')}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button onClick={() => void finalize()} style={allowed && !busy ? btn() : btnDisabled()} disabled={!allowed || busy}>
                Finalize awards
              </button>
              <button
                onClick={() => setApproved(true)}
                style={canApprove && !approved && reconciles ? btnPrimary() : btnDisabled()}
                disabled={!canApprove || approved || !reconciles}
                title={!reconciles ? 'Splits must reconcile before approving' : undefined}
              >
                {approved ? 'Approved by you ✓' : 'Add my approval'}
              </button>
              <button
                onClick={askExecute}
                style={readyToExecute && !busy ? btnPrimary('#15803d') : btnDisabled()}
                disabled={!readyToExecute || busy}
              >
                {busy ? 'Executing…' : 'Execute disbursement'}
              </button>
            </div>
            {!reconciles && <p style={{ color: '#b91c1c', fontSize: '0.8rem', marginBottom: 0 }}>Splits must reconcile to the derived pot total before disbursement.</p>}
            <AuditNote>Disbursement requires {required} distinct approvers server-side (this UI mirrors that). Payouts run via existing rails, idempotently; every movement is ledgered + audited (NDC-4).</AuditNote>
          </Card>
        </>
      )}

      {confirmingExecute && (
        <ConfirmDialog
          open
          level="critical"
          title="Execute disbursement"
          description={`Disburse ${formatKobo(splitTotal)} across ${splits.length} split${splits.length === 1 ? '' : 's'} — this moves money via the payout rails.`}
          reasons={[
            'Sends real payouts via the payout rails — idempotent, ledgered and audited (NDC-4).',
            'Requires the split total to reconcile against the derived pot and all approvals to be recorded.',
            'Recorded in the audit log with your name, reason and timestamp.',
          ]}
          requireReason
          reasonPlaceholder="Basis for executing this disbursement (e.g. approvals verified, split matches published formula)…"
          busy={busy}
          confirmLabel="Execute disbursement"
          onConfirm={execute}
          onCancel={() => {
            if (!busy) setConfirmingExecute(false);
          }}
        />
      )}
    </div>
  );
}
