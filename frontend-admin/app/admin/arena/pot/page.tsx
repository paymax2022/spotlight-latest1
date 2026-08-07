'use client';

// A7 — Pot & disbursement. RBAC: arena.admin.manage (Competition Admin) + a
// second approver (arena.admin.disburse). View derived pot total + contribution
// ledger; define split per the published formula; MULTI-APPROVE (two approvers);
// execute; show disbursement status. Amounts reconcile against the derived pot;
// every movement is ledgered + audited (NDC-4).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCompetitions, getPot, disbursePot, finalizeAwards, formatKobo } from '@/services/arenaAdminService';
import type { Competition, PotView, PotSplit } from '@/types/arenaAdmin';
import { Page, PageHeader, Card, Button, Input, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';
import {
  mono, DisbursementBadge, timeAgo, AuditNote, PermissionBanner, ARENA_PERMS, useArenaPermission, useArenaUser,
} from '../_ui';
import { hasAnyPermission } from '@/features/auth/rbac';

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

  const execute = useCallback(async () => {
    if (!readyToExecute) return;
    if (!window.confirm(`Execute disbursement of ${formatKobo(splitTotal)} across ${splits.length} splits? This moves money via the payout rails.`)) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await disbursePot(competitionId, splits);
      setNotice('Disbursement submitted to payout rails (idempotent, ledgered, audited).');
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [readyToExecute, competitionId, splits, splitTotal, load]);

  return (
    <Page>
      <PageHeader
        title="Arena — Pot & Disbursement (A7)"
        subtitle="Derived pot total + contribution ledger. Define split per published formula, MULTI-APPROVE (two approvers), execute. Reconciles against the derived pot. RBAC: arena.admin.manage."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      {!allowed && <PermissionBanner permission={ARENA_PERMS.admin} />}
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {notice && <div style={{ background: tint(colors.success, 0.12), border: `1px solid ${tint(colors.success, 0.35)}`, borderRadius: '0.5rem', padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: colors.success, marginBottom: '1.25rem' }}>{notice}</div>}

      {loading || !pot ? (
        <Card><p style={{ color: colors.muted }}>Loading pot…</p></Card>
      ) : (
        <>
          <Card title="Derived pot" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase' }}>Total (derived from ledger)</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: colors.text }}>{formatKobo(pot.total_kobo)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase' }}>Disbursement</div>
                <div style={{ marginTop: 4 }}><DisbursementBadge status={pot.disbursement_status} /></div>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase' }}>Published split formula (immutable)</div>
                <div style={{ fontSize: '0.85rem', color: colors.text }}>{pot.split_formula}</div>
              </div>
            </div>
          </Card>

          <Card title="Contribution ledger" style={{ marginBottom: 20 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Source</th>
                    <th style={thCell}>Contestant</th>
                    <th style={thCell}>Amount</th>
                    <th style={thCell}>Ledger entry</th>
                    <th style={thCell}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {(pot.contributions ?? []).map((c) => (
                    <tr key={c.id}>
                      <td style={tdCell}>{c.source}</td>
                      <td style={{ ...tdCell, ...mono() }}>{c.contestant_id ?? '—'}</td>
                      <td style={tdCell}>{formatKobo(c.amount_kobo)}</td>
                      <td style={{ ...tdCell, ...mono() }}>{c.ledger_entry_id ?? '—'}</td>
                      <td style={tdCell}>{timeAgo(c.created_at)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...tdCell, fontWeight: 700 }} colSpan={2}>Derived total</td>
                    <td style={{ ...tdCell, fontWeight: 700 }}>{formatKobo(pot.total_kobo)}</td>
                    <td style={tdCell} colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Disbursement splits" style={{ marginBottom: 20 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thCell}>Allocation</th>
                    <th style={thCell}>Beneficiary</th>
                    <th style={thCell}>Amount (₦)</th>
                  </tr>
                </thead>
                <tbody>
                  {splits.map((s, i) => (
                    <tr key={s.label}>
                      <td style={tdCell}>{s.label}</td>
                      <td style={{ ...tdCell, ...mono() }}>{s.beneficiary ?? '—'}</td>
                      <td style={tdCell}>
                        <Input
                          value={(s.amount_kobo / 100).toString()}
                          onChange={(e) => setSplitAmount(i, e.target.value)}
                          style={{ width: 140 }}
                          disabled={!allowed}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...tdCell, fontWeight: 700 }} colSpan={2}>Split total</td>
                    <td style={{ ...tdCell, fontWeight: 700, color: reconciles ? colors.success : colors.danger }}>
                      {formatKobo(splitTotal)} {reconciles ? '✓ reconciles' : `✗ ≠ ${formatKobo(pot.total_kobo)}`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Multi-approve & execute">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem', marginTop: 8 }}>
              {Array.from({ length: required }).map((_, i) => {
                const met = i < effectiveApprovals;
                return (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.2rem 0.6rem', borderRadius: 9999, fontSize: '0.78rem', fontWeight: 600, color: met ? colors.success : colors.warning, background: met ? tint(colors.success, 0.12) : tint(colors.warning, 0.12) }}>
                    {met ? '✓' : '○'} Approver {i + 1}
                  </span>
                );
              })}
              <span style={{ fontSize: '0.8rem', color: colors.muted }}>{effectiveApprovals}/{required} approvals</span>
            </div>

            {(pot.approvals ?? []).length > 0 && (
              <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: colors.muted }}>
                Recorded: {(pot.approvals ?? []).map((a) => `${a.approver_email ?? a.approver_id} (${timeAgo(a.approved_at)})`).join(', ')}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Button variant="outline" onClick={() => void finalize()} disabled={!allowed || busy}>
                Finalize awards
              </Button>
              <Button
                variant="primary"
                onClick={() => setApproved(true)}
                disabled={!canApprove || approved || !reconciles}
                title={!reconciles ? 'Splits must reconcile before approving' : undefined}
              >
                {approved ? 'Approved by you ✓' : 'Add my approval'}
              </Button>
              <Button
                variant="primary"
                onClick={() => void execute()}
                disabled={!readyToExecute || busy}
              >
                {busy ? 'Executing…' : 'Execute disbursement'}
              </Button>
            </div>
            {!reconciles && <p style={{ color: colors.danger, fontSize: '0.8rem', marginBottom: 0 }}>Splits must reconcile to the derived pot total before disbursement.</p>}
            <AuditNote>Disbursement requires {required} distinct approvers server-side (this UI mirrors that). Payouts run via existing rails, idempotently; every movement is ledgered + audited (NDC-4).</AuditNote>
          </Card>
        </>
      )}
    </Page>
  );
}
