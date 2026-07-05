'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { listReconciliation, resolveBreak, formatNaira } from '@/services/insuranceAdminService';
import type { ReconciliationBreak, BreakStatus } from '@/types/insuranceAdmin';
import {
  PageHeader, InsuranceTabs, Card, Kpi, Badge, DisclosureNote, StateBlock,
  btn, btnPrimary, th, td, input, label, select,
} from '../_ui';

const STATUSES = ['all', 'open', 'investigating', 'resolved'];
const PROVIDERS = ['all', 'mycover', 'octamile'];
const BREAK_TYPES = ['all', 'premium', 'commission', 'claim_payout'];
const RESOLVE_STATUSES: BreakStatus[] = ['investigating', 'resolved'];

export default function InsuranceReconciliationPage() {
  const [rows, setRows] = useState<ReconciliationBreak[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [provider, setProvider] = useState('all');
  const [breakType, setBreakType] = useState('all');

  // inline resolution panel state, keyed by break id
  const [openId, setOpenId] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState<BreakStatus>('resolved');
  const [resolution, setResolution] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await listReconciliation({
        status: status === 'all' ? undefined : status,
        provider: provider === 'all' ? undefined : provider,
        break_type: breakType === 'all' ? undefined : breakType,
      }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, provider, breakType]);

  function openPanel(id: string) {
    setOpenId(id); setResolveStatus('resolved'); setResolution(''); setNote('');
  }

  async function confirm(id: string) {
    if (!resolution.trim()) return;
    setSubmitting(true); setError(null);
    try {
      await resolveBreak(id, { resolution: resolution.trim(), status: resolveStatus, note: note.trim() || undefined });
      setOpenId(null);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setSubmitting(false); }
  }

  const list = rows ?? [];
  const openCount = list.filter((b) => b.status === 'open').length;
  const totalDelta = list.reduce((sum, b) => sum + b.delta_kobo, 0);
  const slaBreached = list.filter((b) => b.sla_breached).length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Insurance — Reconciliation workbench"
        subtitle="Premium, commission and claim-payout breaks vs provider statements. Resolve via investigation notes (money-path corrections are reversing entries only)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="finance" />

      <DisclosureNote>
        Break SLA — any break aged <strong>&gt;72h</strong> or exceeding <strong>0.5% of volume</strong> alerts and escalates.
      </DisclosureNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Open breaks" value={String(openCount)} accent={openCount > 0 ? '#9a3412' : '#15803d'} />
        <Kpi label="Total delta value" value={formatNaira(totalDelta)} accent={totalDelta !== 0 ? '#b91c1c' : undefined} />
        <Kpi label="SLA breached" value={String(slaBreached)} accent="#b91c1c" />
      </div>

      <Card title="Breaks" right={
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label style={label()}>Status</label>
            <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Provider</label>
            <select style={select()} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p === 'all' ? 'All providers' : p}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Break type</label>
            <select style={select()} value={breakType} onChange={(e) => setBreakType(e.target.value)}>
              {BREAK_TYPES.map((t) => <option key={t} value={t}>{t === 'all' ? 'All types' : t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>
      }>
        <StateBlock loading={loading} error={error} empty={list.length === 0} emptyText="No reconciliation breaks.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th()}>ID</th><th style={th()}>Provider</th><th style={th()}>Type</th>
                <th style={th()}>Policy</th><th style={th()}>Paymax</th><th style={th()}>Provider</th>
                <th style={th()}>Delta</th><th style={th()}>Age</th><th style={th()}>Status</th>
                <th style={th()}>Actions</th>
              </tr></thead>
              <tbody>
                {list.map((b) => {
                  const actionable = b.status === 'open' || b.status === 'investigating';
                  const panelOpen = openId === b.id;
                  return (
                    <Fragment key={b.id}>
                      <tr>
                        <td style={td()}><code style={{ fontSize: '0.78rem' }}>{b.id}</code></td>
                        <td style={td()}><Badge status={b.provider} /></td>
                        <td style={td()}><Badge status="normal" label={b.break_type.replace(/_/g, ' ')} /></td>
                        <td style={td()}>
                          {b.policy_id
                            ? <Link href={`/admin/insurance/policies/${b.policy_id}`} style={{ color: '#340075', textDecoration: 'none' }}>{b.policy_id}</Link>
                            : '—'}
                        </td>
                        <td style={td()}>{formatNaira(b.paymax_amount_kobo)}</td>
                        <td style={td()}>{formatNaira(b.provider_amount_kobo)}</td>
                        <td style={{ ...td(), color: b.delta_kobo !== 0 ? '#b91c1c' : undefined, fontWeight: b.delta_kobo !== 0 ? 600 : undefined }}>{formatNaira(b.delta_kobo)}</td>
                        <td style={{ ...td(), color: b.sla_breached ? '#b91c1c' : undefined, fontWeight: b.sla_breached ? 600 : undefined }}>{`${b.age_hours}h`}</td>
                        <td style={td()}><Badge status={b.status} /></td>
                        <td style={td()}>
                          {actionable
                            ? <button onClick={() => (panelOpen ? setOpenId(null) : openPanel(b.id))} style={btn()}>{panelOpen ? 'Cancel' : 'Resolve'}</button>
                            : '—'}
                        </td>
                      </tr>
                      {panelOpen && (
                        <tr>
                          <td style={{ ...td(), background: '#f9fafb' }} colSpan={10}>
                            <div style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.5rem' }}>{b.detail}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '0.75rem', alignItems: 'end' }}>
                              <div>
                                <label style={label()}>Set status</label>
                                <select style={select()} value={resolveStatus} onChange={(e) => setResolveStatus(e.target.value as BreakStatus)}>
                                  {RESOLVE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </div>
                              <div>
                                <label style={label()}>Resolution</label>
                                <input style={input()} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Timing difference cleared on next statement" />
                              </div>
                              <div>
                                <label style={label()}>Note (optional)</label>
                                <input style={input()} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reference / investigation note" />
                              </div>
                              <button disabled={submitting || !resolution.trim()} onClick={() => confirm(b.id)} style={btnPrimary()}>{submitting ? '…' : 'Confirm'}</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
