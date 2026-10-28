'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getReferralsSummary, listReferrals, getReferral,
  type ReferralsSummary, type Referral, type ReferralDetail, type ReferralKind, type Page,
} from '@/services/telemedAdminClaimsService';
import { PageHeader, TelemedTabs, Card, Kpi, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, fmtDate, timeAgo } from '../_ui';
import { colors } from '@/components/ui/vuexy';
import { Drawer, Rows, DetailJson, Pager, SubTabs, humanize } from '../claims/_parts';

const PAGE_SIZE = 20;
const STATUSES: Record<ReferralKind, string[]> = {
  outgoing: ['pending', 'accepted', 'rejected', 'completed'],
  incoming: ['pending', 'accepted', 'rejected', 'completed'],
  opinions: ['pending', 'answered', 'completed'],
};
const COUNTERPART_LABEL: Record<ReferralKind, string> = { outgoing: 'Specialist', incoming: 'Referred by', opinions: '—' };
const empty = (): Page<Referral> => ({ items: [], total: 0, limit: PAGE_SIZE, offset: 0 });

export default function ReferralsConsolePage() {
  const [kind, setKind] = useState<ReferralKind>('outgoing');
  const [summary, setSummary] = useState<ReferralsSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try { setSummary(await getReferralsSummary()); setSummaryError(null); }
    catch (e) { setSummaryError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const pendingTotal =
    (summary?.outgoing_by_status.pending ?? 0) + (summary?.incoming_by_status.pending ?? 0) + (summary?.opinions_by_status.pending ?? 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Referrals & second opinions"
        subtitle="Read-only oversight of clinical referrals between doctors and second-opinion requests. Decisions stay with the clinicians involved."
        action={<button onClick={loadSummary} style={btn()}>Refresh</button>}
      />
      <TelemedTabs active="referrals" />
      <DisclosureNote>
        Patient identities are masked and clinical narrative is limited to a short reason. This console has no write actions.
      </DisclosureNote>

      {summaryError ? <p style={{ color: '#dc2626' }}>Could not load totals: {summaryError}</p> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Outgoing referrals" value={(summary?.outgoing_total ?? 0).toLocaleString('en-NG')} sub={`${summary?.outgoing_by_status.pending ?? 0} pending`} accent="#340075" />
        <Kpi label="Incoming referrals" value={(summary?.incoming_total ?? 0).toLocaleString('en-NG')} sub={`${summary?.incoming_by_status.accepted ?? 0} accepted · ${summary?.incoming_by_status.rejected ?? 0} rejected`} />
        <Kpi label="Second opinions" value={(summary?.opinions_total ?? 0).toLocaleString('en-NG')} sub={`${summary?.opinions_by_status.pending ?? 0} pending`} />
        <Kpi label="Awaiting a decision" value={pendingTotal.toLocaleString('en-NG')} accent={pendingTotal > 0 ? '#9a3412' : undefined} />
      </div>

      <SubTabs
        active={kind}
        onChange={setKind}
        tabs={[
          { key: 'outgoing', label: 'Outgoing', count: summary?.outgoing_total },
          { key: 'incoming', label: 'Incoming', count: summary?.incoming_total },
          { key: 'opinions', label: 'Second opinions', count: summary?.opinions_total },
        ]}
      />
      <ReferralList key={kind} kind={kind} />
    </div>
  );
}

function ReferralList({ kind }: { kind: ReferralKind }) {
  const [page, setPage] = useState<Page<Referral>>(empty());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ReferralDetail | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setPage(await listReferrals(kind, { status: status || undefined, q: q.trim() || undefined, limit: PAGE_SIZE, offset })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
    // q is applied on Enter / Apply only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, status, offset]);
  useEffect(() => { load(); }, [load]);

  const apply = () => { if (offset === 0) load(); else setOffset(0); };
  async function view(id: string) {
    setOpen(null); setOpenError(null);
    try { setOpen(await getReferral(kind, id)); } catch (e) { setOpenError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <>
      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Clinician or id…" value={q} maxLength={64} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value); }}>
            <option value="">All</option>
            {STATUSES[kind].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
        </div>
        <button style={btn()} onClick={apply}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={page.items.length === 0} emptyText="No records match these filters.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Clinician</th>
              {kind !== 'opinions' && <th style={th()}>{COUNTERPART_LABEL[kind]}</th>}
              <th style={th()}>Patient</th><th style={th()}>{kind === 'opinions' ? 'Question' : 'Reason'}</th>
              <th style={th()}>Status</th><th style={th()}>Created</th><th style={th()} />
            </tr></thead>
            <tbody>
              {page.items.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{r.doctor_name}</td>
                  {kind !== 'opinions' && <td style={td()}>{r.counterpart || '—'}</td>}
                  <td style={td()}>{r.patient_masked}</td>
                  <td style={{ ...td(), maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.reason || '—'}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>{fmtDate(r.created_at)}</td>
                  <td style={td()}><button style={btn()} onClick={() => view(r.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={page.total} offset={offset} limit={PAGE_SIZE} onPage={setOffset} />
        </StateBlock>
      </Card>

      {(open || openError) && (
        <Drawer title={kind === 'opinions' ? 'Second-opinion request' : `${kind === 'outgoing' ? 'Outgoing' : 'Incoming'} referral`} onClose={() => { setOpen(null); setOpenError(null); }}>
          {openError && <p style={{ color: '#dc2626' }}>{openError}</p>}
          {open && (
            <>
              <Rows rows={[
                ['Status', <Badge key="s" status={open.status} />],
                ['Clinician', open.doctor_name],
                ...(kind !== 'opinions' ? [[COUNTERPART_LABEL[kind], open.counterpart || '—']] as [string, string][] : []),
                ['Patient', open.patient_masked],
                [kind === 'opinions' ? 'Question' : 'Reason', open.reason || '—'],
                ['Created', fmtDate(open.created_at)],
                ['Last updated', timeAgo(open.updated_at)],
              ]} />
              <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.4rem', color: colors.text }}>Detail</h3>
              <DetailJson detail={open.detail} />
            </>
          )}
        </Drawer>
      )}
    </>
  );
}
