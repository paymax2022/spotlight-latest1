'use client';

import { useEffect, useState } from 'react';
import { listKyc, decideKyc } from '@/services/staysAdminService';
import type { KycCase, KycStatus, KycDecisionVerb } from '@/types/staysAdmin';
import {
  StaysTabs,
  Badge,
  StateBlock,
  FilterBar,
  DisclosureNote,
  label,
  select,
  timeAgo,
} from '../_ui';
import { Page, PageHeader, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES: KycStatus[] = ['submitted', 'pending', 'in_progress', 'approved', 'rejected', 'needs_changes'];

export default function StaysKycPage() {
  const [rows, setRows] = useState<KycCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('submitted');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listKyc(status ? { status } : undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(id: string, decision: KycDecisionVerb) {
    let note: string | undefined;
    if (decision !== 'approve') {
      const entered = window.prompt(
        decision === 'reject' ? 'Reason for rejecting this business verification (shown to the hotelier):' : 'What does the hotelier need to change?',
      );
      if (!entered?.trim()) return; // cancelled / blank: the backend requires a note
      note = entered.trim();
    } else if (!window.confirm('Approve this business verification?')) {
      return;
    }
    setBusyId(id); setError(null);
    try {
      await decideKyc(id, { decision, note });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Hotelier KYC & verification"
        subtitle="Review business (KYB) verification for direct-rail hoteliers before they can go live and receive Naira payouts."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="trust" />

      <DisclosureNote>
        Approval gates go-live eligibility. RC numbers, director names and BVNs are masked here;
        the hotelier&apos;s documents are the source of truth. Rejecting or requesting changes requires a reason.
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No KYC cases found.">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thCell}>Business</th>
              <th style={thCell}>Property</th>
              <th style={thCell}>City</th>
              <th style={thCell}>RC</th>
              <th style={thCell}>Director</th>
              <th style={thCell}>Identity</th>
              <th style={thCell}>Documents</th>
              <th style={thCell}>Status</th>
              <th style={thCell}>Submitted</th>
              <th style={thCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const busy = busyId === r.property_id;
              return (
                <tr key={r.property_id}>
                  <td style={tdCell}>{r.legal_name || '—'}</td>
                  <td style={tdCell}>{r.property_name || r.property_id}</td>
                  <td style={tdCell}>{r.city || '—'}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.rc_number_masked || '—'}</code></td>
                  <td style={tdCell}>{r.director_masked || '—'}{r.director_bvn_last4 ? <span style={{ color: colors.muted }}> · BVN ••••{r.director_bvn_last4}</span> : null}</td>
                  <td style={tdCell}><Badge status={r.kyc_status} /></td>
                  <td style={tdCell}><Badge status={r.business_doc_status} /></td>
                  <td style={tdCell}><Badge status={r.status} /></td>
                  <td style={tdCell}>{r.submitted_at ? timeAgo(r.submitted_at) : '—'}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      <Button variant="primary" sm disabled={busy} onClick={() => decide(r.property_id, 'approve')}>Approve</Button>
                      <Button variant="danger" sm disabled={busy} onClick={() => decide(r.property_id, 'reject')}>Reject</Button>
                      <Button variant="outline" sm disabled={busy} onClick={() => decide(r.property_id, 'needs_changes')}>Needs changes</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StateBlock>
    </Page>
  );
}
