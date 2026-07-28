'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { getAjoCircle, handleDefault, formatNaira } from '@/services/savingsAdminService';
import type { AjoCircleDetail, AjoMember, DefaultAction } from '@/types/savingsAdmin';
import { PageHeader, SavingsTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, AuditNote, btn, btnDanger, th, td, fmtDate, pct } from '../../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Ajo circle detail" subtitle={`Cycle progress, payout order and member roster for circle ${id}.`} action={<Link href="/admin/savings/ajo" style={{ ...btn(), textDecoration: 'none' }}>← Circles</Link>} />
      <SavingsTabs active="ajo" />
      <DisclosureNote>NL-7 — payout order is peer-defined and immutable once the circle is active; Paymax never reorders, advances funds, or covers a default. Default handling is policy-driven (grace / make-good / remove) and fully audited.</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <StateBlock loading={loading} error={error} empty={!data} emptyText="Circle not found.">
        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Circle" value={data.name} sub={`${formatNaira(data.contribution_kobo)} / ${data.frequency}`} />
              <Kpi label="Status" value={data.status} />
              <Kpi label="Health" value={data.health} accent={data.health === 'healthy' ? '#15803d' : data.health === 'defaulted' ? '#b91c1c' : '#9a3412'} />
              <Kpi label="Cycle" value={`${data.cycle_index}/${data.total_cycles}`} />
              <Kpi label="Escrow held" value={formatNaira(data.escrow_held_kobo)} sub="Paymax escrow only (NL-7)" accent="#340075" />
              <Kpi label="Collected this cycle" value={formatNaira(data.collected_this_cycle_kobo)} sub={`of ${formatNaira(data.expected_this_cycle_kobo)}`} />
              <Kpi label="Defaults" value={`${data.defaults_count}`} accent={data.defaults_count > 0 ? '#b91c1c' : '#15803d'} />
              <Kpi label="Payout order" value={data.payout_order_locked ? 'Locked' : 'Open'} sub="Peer-defined" />
            </div>

            <Card title="Cycles & payout order">
              {data.cycles.length === 0 ? <p style={{ color: '#6b7280' }}>No cycle data.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th()}>#</th><th style={th()}>Beneficiary</th><th style={th()}>Payout</th><th style={th()}>Collected</th><th style={th()}>Status</th><th style={th()}>Date</th></tr></thead>
                  <tbody>
                    {data.cycles.map((cy) => (
                      <tr key={cy.cycle_index}>
                        <td style={td()}>{cy.cycle_index}</td>
                        <td style={td()}>{cy.beneficiary_masked}</td>
                        <td style={td()}>{formatNaira(cy.payout_kobo)}</td>
                        <td style={td()}>{formatNaira(cy.collected_kobo)} <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>/ {formatNaira(cy.expected_kobo)} ({cy.expected_kobo ? pct(cy.collected_kobo / cy.expected_kobo) : '0%'})</span></td>
                        <td style={td()}><Badge status={cy.status} /></td>
                        <td style={td()}>{fmtDate(cy.payout_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Members" right={<span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Default handling is audited</span>}>
              {data.members.length === 0 ? <p style={{ color: '#6b7280' }}>No members loaded.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th()}>Member</th><th style={th()}>Status</th><th style={th()}>Position</th><th style={th()}>Paid</th><th style={th()}>Missed</th>
                    <th style={th()}>Received payout</th><th style={th()}>Contributed</th><th style={th()}>Default handling</th>
                  </tr></thead>
                  <tbody>
                    {data.members.map((m) => (
                      <tr key={m.id}>
                        <td style={td()}>{m.masked_name}</td>
                        <td style={td()}><Badge status={m.status} /></td>
                        <td style={td()}>{m.payout_position}</td>
                        <td style={td()}>{m.paid_cycles}</td>
                        <td style={td()}>{m.missed_cycles > 0 ? <Badge status="late" label={`${m.missed_cycles}`} /> : 0}</td>
                        <td style={td()}>{m.has_received_payout ? 'Yes' : 'No'}</td>
                        <td style={td()}>{formatNaira(m.contributed_kobo)}</td>
                        <td style={td()}>
                          {m.status === 'defaulted' ? (
                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                              <button style={btn()} disabled={busy === m.id} onClick={() => onDefault(m, 'grace')}>Grace</button>
                              <button style={btn()} disabled={busy === m.id} onClick={() => onDefault(m, 'make_good')}>Make-good</button>
                              <button style={btn()} disabled={busy === m.id} onClick={() => onDefault(m, 'recover')}>Recover</button>
                              <button style={btnDanger()} disabled={busy === m.id} onClick={() => onDefault(m, 'remove')}>Remove</button>
                            </div>
                          ) : <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
