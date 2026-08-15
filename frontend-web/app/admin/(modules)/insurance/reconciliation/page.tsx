'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { listReconciliation, resolveBreak, formatNaira } from '@/services/insuranceAdminService';
import type { ReconciliationBreak, BreakStatus } from '@/types/insuranceAdmin';
import { InsuranceTabs, Kpi, DisclosureNote, StateBlock } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['all', 'open', 'investigating', 'resolved'];
const PROVIDERS = ['all', 'mycover', 'octamile'];
const BREAK_TYPES = ['all', 'premium', 'commission', 'claim_payout'];
const RESOLVE_STATUSES: BreakStatus[] = ['investigating', 'resolved'];

const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 4 };

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'resolved' || s === 'active') return colors.success;
  if (s === 'open') return colors.warning;
  if (s === 'investigating') return colors.info;
  if (s === 'mycover' || s === 'octamile') return colors.info;
  return colors.secondary;
}

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
    <Page>
      <PageHeader
        title="Insurance — Reconciliation workbench"
        subtitle="Premium, commission and claim-payout breaks vs provider statements. Resolve via investigation notes (money-path corrections are reversing entries only)."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InsuranceTabs active="finance" />

      <DisclosureNote>
        Break SLA — any break aged <strong>&gt;72h</strong> or exceeding <strong>0.5% of volume</strong> alerts and escalates.
      </DisclosureNote>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Kpi label="Open breaks" value={String(openCount)} accent={openCount > 0 ? colors.warning : colors.success} />
        <Kpi label="Total delta value" value={formatNaira(totalDelta)} accent={totalDelta !== 0 ? colors.danger : undefined} />
        <Kpi label="SLA breached" value={String(slaBreached)} accent={colors.danger} />
      </div>

      <Card title="Breaks">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 14 }}>
          <div>
            <label style={fieldLabel}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLabel}>Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p === 'all' ? 'All providers' : p}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLabel}>Break type</label>
            <select value={breakType} onChange={(e) => setBreakType(e.target.value)}>
              {BREAK_TYPES.map((t) => <option key={t} value={t}>{t === 'all' ? 'All types' : t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>

        <StateBlock loading={loading} error={error} empty={list.length === 0} emptyText="No reconciliation breaks.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>ID</th><th style={thCell}>Provider</th><th style={thCell}>Type</th>
                <th style={thCell}>Policy</th><th style={thCell}>Paymax</th><th style={thCell}>Provider</th>
                <th style={thCell}>Delta</th><th style={thCell}>Age</th><th style={thCell}>Status</th>
                <th style={thCell}>Actions</th>
              </tr></thead>
              <tbody>
                {list.map((b) => {
                  const actionable = b.status === 'open' || b.status === 'investigating';
                  const panelOpen = openId === b.id;
                  return (
                    <Fragment key={b.id}>
                      <tr>
                        <td style={tdCell}><code style={{ fontSize: 12 }}>{b.id}</code></td>
                        <td style={tdCell}><Badge text={b.provider} color={statusColor(b.provider)} /></td>
                        <td style={tdCell}><Badge text={b.break_type.replace(/_/g, ' ')} color={colors.info} /></td>
                        <td style={tdCell}>
                          {b.policy_id
                            ? <Link href={`/admin/insurance/policies/${b.policy_id}`} style={{ color: colors.primary, textDecoration: 'none' }}>{b.policy_id}</Link>
                            : '—'}
                        </td>
                        <td style={tdCell}>{formatNaira(b.paymax_amount_kobo)}</td>
                        <td style={tdCell}>{formatNaira(b.provider_amount_kobo)}</td>
                        <td style={{ ...tdCell, color: b.delta_kobo !== 0 ? colors.danger : undefined, fontWeight: b.delta_kobo !== 0 ? 600 : undefined }}>{formatNaira(b.delta_kobo)}</td>
                        <td style={{ ...tdCell, color: b.sla_breached ? colors.danger : undefined, fontWeight: b.sla_breached ? 600 : undefined }}>{`${b.age_hours}h`}</td>
                        <td style={tdCell}><Badge text={b.status} color={statusColor(b.status)} /></td>
                        <td style={tdCell}>
                          {actionable
                            ? <Button variant="outline" sm onClick={() => (panelOpen ? setOpenId(null) : openPanel(b.id))}>{panelOpen ? 'Cancel' : 'Resolve'}</Button>
                            : '—'}
                        </td>
                      </tr>
                      {panelOpen && (
                        <tr>
                          <td style={{ ...tdCell, background: colors.headBg }} colSpan={10}>
                            <div style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>{b.detail}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12, alignItems: 'end' }}>
                              <div>
                                <label style={fieldLabel}>Set status</label>
                                <select value={resolveStatus} onChange={(e) => setResolveStatus(e.target.value as BreakStatus)}>
                                  {RESOLVE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </div>
                              <div>
                                <label style={fieldLabel}>Resolution</label>
                                <Input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Timing difference cleared on next statement" />
                              </div>
                              <div>
                                <label style={fieldLabel}>Note (optional)</label>
                                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reference / investigation note" />
                              </div>
                              <Button variant="primary" disabled={submitting || !resolution.trim()} onClick={() => confirm(b.id)}>{submitting ? '…' : 'Confirm'}</Button>
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
    </Page>
  );
}
