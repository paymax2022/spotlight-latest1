'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { getAjoCircle, handleDefault, formatNaira } from '@/services/savingsAdminService';
import type { AjoCircleDetail, AjoMember, DefaultAction } from '@/types/savingsAdmin';
import { SavingsTabs, Kpi, DisclosureNote, StateBlock, AuditNote, fmtDate, pct } from '../../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const SUCCESS_STATUSES = new Set(['active', 'open', 'matured', 'completed', 'settled', 'reconciled', 'resolved', 'paid', 'healthy', 'approved', 'on_track', 'recovered', 'cleared', 'balanced', 'verified', 'contribution']);
const DANGER_STATUSES = new Set(['rejected', 'failed', 'defaulted', 'blocked', 'high', 'critical', 'breached', 'suspended', 'impersonation', 'abuse']);
const WARNING_STATUSES = new Set(['pending', 'forming', 'scheduled', 'queued', 'flagged', 'degraded', 'at_risk', 'locked', 'grace', 'review', 'under_review', 'late', 'medium', 'debit', 'hold']);
const INFO_STATUSES = new Set(['investigating', 'processing', 'collecting', 'flex', 'normal', 'invited', 'payment', 'split', 'payout']);
const PRIMARY_STATUSES = new Set(['refunded', 'reversed', 'reversal', 'make_good', 'pool', 'request']);

function badgeColor(status: string): string {
  const s = status.toLowerCase();
  if (SUCCESS_STATUSES.has(s)) return colors.success;
  if (DANGER_STATUSES.has(s)) return colors.danger;
  if (WARNING_STATUSES.has(s)) return colors.warning;
  if (INFO_STATUSES.has(s)) return colors.info;
  if (PRIMARY_STATUSES.has(s)) return colors.primary;
  return colors.secondary;
}

function badgeText(status: string, label?: string): string {
  const t = (label ?? status.replace(/_/g, ' ')).toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function AjoCircleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<AjoCircleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getAjoCircle(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function onDefault(m: AjoMember, action: DefaultAction) {
    const note = window.prompt(`Apply "${action}" to defaulting member ${m.masked_name}? This is audited. Optional note:`) ?? undefined;
    if (note === undefined && action === 'remove') return; // require ack for removal
    setBusy(m.id); setMsg(null);
    try {
      const res = await handleDefault(`${id}:${m.id}`, action, note);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Ajo circle detail" subtitle={`Cycle progress, payout order and member roster for circle ${id}.`} actions={<Link href="/admin/savings/ajo" className="vx-btn vx-btn--outline" style={{ textDecoration: 'none' }}>← Circles</Link>} />
      <SavingsTabs active="ajo" />
      <DisclosureNote>NL-7 — payout order is peer-defined and immutable once the circle is active; Paymax never reorders, advances funds, or covers a default. Default handling is policy-driven (grace / make-good / remove) and fully audited.</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Circle not found.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Circle" value={data.name} sub={`${formatNaira(data.contribution_kobo)} / ${data.frequency}`} />
              <Kpi label="Status" value={data.status} />
              <Kpi label="Health" value={data.health} accent={data.health === 'healthy' ? colors.success : data.health === 'defaulted' ? colors.danger : colors.warning} />
              <Kpi label="Cycle" value={`${data.cycle_index}/${data.total_cycles}`} />
              <Kpi label="Escrow held" value={formatNaira(data.escrow_held_kobo)} sub="Paymax escrow only (NL-7)" accent={colors.primary} />
              <Kpi label="Collected this cycle" value={formatNaira(data.collected_this_cycle_kobo)} sub={`of ${formatNaira(data.expected_this_cycle_kobo)}`} />
              <Kpi label="Defaults" value={`${data.defaults_count}`} accent={data.defaults_count > 0 ? colors.danger : colors.success} />
              <Kpi label="Payout order" value={data.payout_order_locked ? 'Locked' : 'Open'} sub="Peer-defined" />
            </div>

            <Card title="Cycles & payout order">
              {data.cycles.length === 0 ? <p style={{ color: colors.muted }}>No cycle data.</p> : (
                <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>#</th><th style={thCell}>Beneficiary</th><th style={thCell}>Payout</th><th style={thCell}>Collected</th><th style={thCell}>Status</th><th style={thCell}>Date</th></tr></thead>
                  <tbody>
                    {data.cycles.map((cy) => (
                      <tr key={cy.cycle_index}>
                        <td style={tdCell}>{cy.cycle_index}</td>
                        <td style={tdCell}>{cy.beneficiary_masked}</td>
                        <td style={tdCell}>{formatNaira(cy.payout_kobo)}</td>
                        <td style={tdCell}>{formatNaira(cy.collected_kobo)} <span style={{ color: colors.muted, fontSize: '0.72rem' }}>/ {formatNaira(cy.expected_kobo)} ({cy.expected_kobo ? pct(cy.collected_kobo / cy.expected_kobo) : '0%'})</span></td>
                        <td style={tdCell}><Badge text={badgeText(cy.status)} color={badgeColor(cy.status)} /></td>
                        <td style={tdCell}>{fmtDate(cy.payout_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>Members</h2>
                <span style={{ fontSize: '0.75rem', color: colors.muted }}>Default handling is audited</span>
              </div>
              {data.members.length === 0 ? <p style={{ color: colors.muted }}>No members loaded.</p> : (
                <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>Member</th><th style={thCell}>Status</th><th style={thCell}>Position</th><th style={thCell}>Paid</th><th style={thCell}>Missed</th>
                    <th style={thCell}>Received payout</th><th style={thCell}>Contributed</th><th style={thCell}>Default handling</th>
                  </tr></thead>
                  <tbody>
                    {data.members.map((m) => (
                      <tr key={m.id}>
                        <td style={tdCell}>{m.masked_name}</td>
                        <td style={tdCell}><Badge text={badgeText(m.status)} color={badgeColor(m.status)} /></td>
                        <td style={tdCell}>{m.payout_position}</td>
                        <td style={tdCell}>{m.paid_cycles}</td>
                        <td style={tdCell}>{m.missed_cycles > 0 ? <Badge text={`${m.missed_cycles}`} color={badgeColor('late')} /> : 0}</td>
                        <td style={tdCell}>{m.has_received_payout ? 'Yes' : 'No'}</td>
                        <td style={tdCell}>{formatNaira(m.contributed_kobo)}</td>
                        <td style={tdCell}>
                          {m.status === 'defaulted' ? (
                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                              <Button variant="outline" sm disabled={busy === m.id} onClick={() => onDefault(m, 'grace')}>Grace</Button>
                              <Button variant="outline" sm disabled={busy === m.id} onClick={() => onDefault(m, 'make_good')}>Make-good</Button>
                              <Button variant="outline" sm disabled={busy === m.id} onClick={() => onDefault(m, 'recover')}>Recover</Button>
                              <Button variant="danger" sm disabled={busy === m.id} onClick={() => onDefault(m, 'remove')}>Remove</Button>
                            </div>
                          ) : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </Page>
  );
}
