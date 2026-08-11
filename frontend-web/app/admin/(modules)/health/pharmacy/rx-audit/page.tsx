'use client';

import { useEffect, useState } from 'react';
import { listRxAudit, listControlledLog } from '@/services/healthPharmacyAdminService';
import type { RxAuditItem, ControlledLogEntry } from '@/types/healthAdmin';
import { PageHeader, PharmacyTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, timeAgo } from '../../_ui';
import { colors } from '@/components/ui/vuexy';

export default function RxAuditPage() {
  const [rxRows, setRxRows] = useState<RxAuditItem[]>([]);
  const [ctlRows, setCtlRows] = useState<ControlledLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      const [rx, ctl] = await Promise.all([
        listRxAudit({ status: status || undefined, q: q || undefined }),
        listControlledLog({ q: q || undefined }),
      ]);
      setRxRows(rx); setCtlRows(ctl);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Rx & controlled-substance audit" subtitle="Read-only oversight of e-prescription verification and the dispense-once invariant, plus the controlled-substance attempt log. Patient/prescriber identities are masked (NDPA)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <PharmacyTabs active="rx-audit" />
      <DisclosureNote>POM items require a valid e-prescription verified by a licensed pharmacist before fulfilment (HL-3); dispense-once is enforced server-side (a prescription cannot be filled twice). Controlled substances are excluded at MVP — every attempt is blocked and logged (HL-4). Records are read here for audit (HL-12); identities are masked (HL-8).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Patient, pharmacy, order or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Rx status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="verifying">Verifying</option>
            <option value="verified">Verified</option>
            <option value="dispensed">Dispensed</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card title="Prescription verification audit (HL-3)">
        <StateBlock loading={loading} error={error} empty={rxRows.length === 0} emptyText="No prescriptions match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Rx</th><th style={th()}>Patient</th><th style={th()}>Pharmacist</th><th style={th()}>POM / ctrl</th>
              <th style={th()}>Dispense-once</th><th style={th()}>Verify</th><th style={th()}>Order</th><th style={th()}>Status</th>
            </tr></thead>
            <tbody>
              {rxRows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.id}</code><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.prescriber_masked}</div></td>
                  <td style={td()}>{r.patient_masked}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.pharmacy_masked}</div></td>
                  <td style={td()}>{r.pharmacist_masked ?? <span style={{ color: colors.muted }}>— unassigned</span>}</td>
                  <td style={td()}>{r.pom_items} POM{r.controlled_items > 0 && <div style={{ marginTop: 4 }}><Badge status="controlled" label={`${r.controlled_items} controlled`} /></div>}</td>
                  <td style={td()}><Badge status={r.dispense_once_ok ? 'ok' : 'breached'} label={r.dispense_once_ok ? 'held' : 'breach'} /></td>
                  <td style={td()}>{r.verify_minutes != null ? `${r.verify_minutes}m` : '—'}</td>
                  <td style={td()}>{r.order_ref ? <code style={{ fontSize: '0.78rem' }}>{r.order_ref}</code> : '—'}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      <Card title="Controlled-substance attempt log (HL-4)" right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>Excluded at MVP — all attempts blocked</span>}>
        <StateBlock loading={loading} error={error} empty={ctlRows.length === 0} emptyText="No controlled-substance attempts logged.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Substance</th><th style={th()}>Schedule</th><th style={th()}>Pharmacy</th><th style={th()}>Attempted by</th><th style={th()}>Outcome</th><th style={th()}>Reason</th><th style={th()}>When</th></tr></thead>
            <tbody>
              {ctlRows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><div style={{ fontWeight: 600 }}>{r.substance}</div><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                  <td style={td()}>{r.schedule}</td>
                  <td style={td()}>{r.pharmacy_masked}</td>
                  <td style={td()}>{r.attempted_by_masked}</td>
                  <td style={td()}><Badge status={r.outcome} /></td>
                  <td style={td()}>{r.reason}</td>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
