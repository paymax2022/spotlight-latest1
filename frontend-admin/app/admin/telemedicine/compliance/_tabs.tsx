'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  listLicences, listSuspended, listAudit, listTraining, listQuality, listRecordAccess, listDocAccess,
  type LicenceBucket, type LicenceRow, type SuspendedClinician, type AuditEvent, type TrainingRow,
  type QualityRow, type RecordAccessRow, type DocAccessRow, type Page,
} from '@/services/telemedAdminComplianceService';
import { Badge, StateBlock, FilterBar, btn, btnDanger, btnPrimary, th, td, input, label, select, timeAgo, fmtDate } from '../_ui';

export const PAGE_SIZE = 25;

/** What a row-level action on a clinician asks the shell to do. */
export type ClinicianAction = { kind: 'suspend' | 'reinstate'; userId: string; name: string };

interface TabProps {
  /** Bumped by the shell after a suspend/reinstate so every tab refetches. */
  refreshKey: number;
  onAction: (a: ClinicianAction) => void;
}

/** Paged fetch with honest loading/error state. */
function usePaged<T>(fetcher: (offset: number) => Promise<Page<T>>, deps: unknown[], refreshKey: number) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Page<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A changed filter starts again from the first page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setOffset(0); }, deps);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fetcher(offset)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, refreshKey, ...deps]);
  useEffect(() => { load(); }, [load]);

  return { data, loading, error, offset, setOffset, reload: load };
}

function Pager({ total, offset, setOffset }: { total: number; offset: number; setOffset: (n: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  const from = offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  return (
    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.8rem' }}>
      <button style={btn()} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
      <span style={{ color: '#6b7280' }}>{from}–{to} of {total.toLocaleString('en-NG')}</span>
      <button style={btn()} disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{head.map((h) => <th key={h} style={th()}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const BUCKET_STYLE: Record<string, { status: string; label: string }> = {
  expired: { status: 'rejected', label: 'Expired' },
  '30d': { status: 'pending', label: 'Within 30 days' },
  '90d': { status: 'in_progress', label: 'Within 90 days' },
  later: { status: 'active', label: 'Valid' },
};

function expiryText(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

export function LicenceTab({ refreshKey, onAction }: TabProps) {
  const [bucket, setBucket] = useState<LicenceBucket>('all');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const { data, loading, error, offset, setOffset, reload } = usePaged<LicenceRow>(
    (o) => listLicences({ bucket, q: applied, limit: PAGE_SIZE, offset: o }), [bucket, applied], refreshKey);

  return (
    <>
      <FilterBar>
        <div>
          <label style={label()}>Expiry window</label>
          <select style={select()} value={bucket} onChange={(e) => setBucket(e.target.value as LicenceBucket)}>
            <option value="all">All approved clinicians</option>
            <option value="expired">Expired</option>
            <option value="30d">Expiring within 30 days</option>
            <option value="90d">Expiring in 31–90 days</option>
          </select>
        </div>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Name or MDCN number</label>
          <input style={input()} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setApplied(q); }} placeholder="Search…" />
        </div>
        <button style={btn()} onClick={() => setApplied(q)}>Apply</button>
        <button style={btn()} onClick={reload}>Refresh</button>
      </FilterBar>
      <StateBlock loading={loading && !data} error={error} empty={!!data && data.items.length === 0} emptyText="No clinicians match — only clinicians with an approved verification that records a licence expiry appear here.">
        {data && (
          <>
            <Table head={['Clinician', 'MDCN', 'Specialty', 'Licence expiry', 'Window', 'Profile', '']}>
              {data.items.map((r) => {
                const b = BUCKET_STYLE[r.bucket];
                return (
                  <tr key={r.user_id}>
                    <td style={td()}>{r.name || '—'}</td>
                    <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.mdcn_number ?? '—'}</code></td>
                    <td style={td()}>{r.specialty || '—'}</td>
                    <td style={td()}>{fmtDate(r.licence_expiry)}<div style={{ color: '#6b7280', fontSize: '0.75rem' }}>{expiryText(r.days_to_expiry)}</div></td>
                    <td style={td()}><Badge status={b.status} label={b.label} /></td>
                    <td style={td()}><Badge status={r.profile_status === 'approved' ? 'active' : r.profile_status} label={r.profile_status} /></td>
                    <td style={td()}>
                      {r.profile_status === 'approved'
                        ? <button style={btnDanger()} onClick={() => onAction({ kind: 'suspend', userId: r.user_id, name: r.name })}>Suspend</button>
                        : r.profile_status === 'suspended'
                          ? <button style={btn()} onClick={() => onAction({ kind: 'reinstate', userId: r.user_id, name: r.name })}>Reinstate</button>
                          : null}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pager total={data.total} offset={offset} setOffset={setOffset} />
          </>
        )}
      </StateBlock>
    </>
  );
}

export function SuspendedTab({ refreshKey, onAction }: TabProps) {
  const { data, loading, error, offset, setOffset, reload } = usePaged<SuspendedClinician>(
    (o) => listSuspended({ limit: PAGE_SIZE, offset: o }), [], refreshKey);

  return (
    <>
      <FilterBar><button style={btn()} onClick={reload}>Refresh</button></FilterBar>
      <StateBlock loading={loading && !data} error={error} empty={!!data && data.items.length === 0} emptyText="No clinicians are suspended.">
        {data && (
          <>
            <Table head={['Clinician', 'MDCN', 'Licence expiry', 'Suspended', 'By', 'Reason', '']}>
              {data.items.map((r) => (
                <tr key={r.user_id}>
                  <td style={td()}>{r.name || '—'}<div style={{ color: '#6b7280', fontSize: '0.75rem' }}>{r.specialty}</div></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.mdcn_number ?? '—'}</code></td>
                  <td style={td()}>
                    {r.licence_expiry ? fmtDate(r.licence_expiry) : '—'}
                    {r.licence_expired ? <div><Badge status="rejected" label="Expired" /></div> : null}
                  </td>
                  <td style={td()}>{r.suspended_at ? timeAgo(r.suspended_at) : '—'}</td>
                  <td style={td()}>{r.suspended_by === 'admin' ? 'Admin' : r.suspended_by === 'system' ? 'Licence sweep' : 'Unknown'}</td>
                  <td style={td()}>{r.reason ?? (r.suspended_by === 'system' ? 'Licence expired' : '—')}</td>
                  <td style={td()}>
                    <button style={btnPrimary()} disabled={r.licence_expired} title={r.licence_expired ? 'Licence has expired — the clinician must renew verification first' : undefined}
                      onClick={() => onAction({ kind: 'reinstate', userId: r.user_id, name: r.name })}>Reinstate</button>
                  </td>
                </tr>
              ))}
            </Table>
            <Pager total={data.total} offset={offset} setOffset={setOffset} />
          </>
        )}
      </StateBlock>
    </>
  );
}

export function AuditTab({ refreshKey }: Pick<TabProps, 'refreshKey'>) {
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ action: '', userId: '', from: '', to: '' });
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading, error, offset, setOffset, reload } = usePaged<AuditEvent>(
    (o) => listAudit({
      action: applied.action, userId: applied.userId,
      from: applied.from ? new Date(applied.from).toISOString() : undefined,
      // `to` is a day: include the whole day.
      to: applied.to ? new Date(new Date(applied.to).getTime() + 86_400_000).toISOString() : undefined,
      limit: PAGE_SIZE, offset: o,
    }), [applied], refreshKey);

  return (
    <>
      <FilterBar>
        <div>
          <label style={label()}>Action</label>
          <select style={select()} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            <option value="doctor.admin.suspended">Suspended by admin</option>
            <option value="doctor.admin.reinstated">Reinstated by admin</option>
            <option value="doctor.mdcn.licence.auto_suspended">Licence sweep suspension</option>
            <option value="policy.ack">Policy acknowledged</option>
          </select>
        </div>
        <div style={{ minWidth: 260 }}>
          <label style={label()}>Clinician user id</label>
          <input style={input()} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="uuid" />
        </div>
        <div><label style={label()}>From</label><input style={input()} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label style={label()}>To</label><input style={input()} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button style={btn()} onClick={() => setApplied({ action, userId, from, to })}>Apply</button>
        <button style={btn()} onClick={reload}>Refresh</button>
      </FilterBar>
      <StateBlock loading={loading && !data} error={error} empty={!!data && data.items.length === 0} emptyText="No audit events match these filters.">
        {data && (
          <>
            <Table head={['When', 'Clinician', 'Action', 'Entity', 'Detail']}>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td style={td()}>{timeAgo(e.created_at)}<div style={{ color: '#6b7280', fontSize: '0.72rem' }}>{new Date(e.created_at).toLocaleString('en-NG')}</div></td>
                  <td style={td()}>{e.user_name ?? '—'}<div><code style={{ fontSize: '0.7rem', color: '#6b7280' }}>{e.user_id.slice(0, 8)}…</code></div></td>
                  <td style={td()}><Badge status={e.action.includes('suspend') ? 'rejected' : e.action.includes('reinstate') ? 'active' : 'pending'} label={e.action} /></td>
                  <td style={td()}>{e.entity_type ?? '—'}</td>
                  <td style={td()}>
                    <button style={btn()} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'View'}</button>
                    {open === e.id ? <pre style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', whiteSpace: 'pre-wrap', maxWidth: 420 }}>{JSON.stringify(e.detail, null, 2)}</pre> : null}
                  </td>
                </tr>
              ))}
            </Table>
            <Pager total={data.total} offset={offset} setOffset={setOffset} />
          </>
        )}
      </StateBlock>
    </>
  );
}

export function TrainingTab({ refreshKey }: Pick<TabProps, 'refreshKey'>) {
  const [status, setStatus] = useState<'' | 'pending' | 'completed'>('pending');
  const { data, loading, error, offset, setOffset, reload } = usePaged<TrainingRow>(
    (o) => listTraining({ status, limit: PAGE_SIZE, offset: o }), [status], refreshKey);

  return (
    <>
      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value as '' | 'pending' | 'completed')}>
            <option value="">All</option>
            <option value="pending">Not completed</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <button style={btn()} onClick={reload}>Refresh</button>
      </FilterBar>
      <StateBlock loading={loading && !data} error={error} empty={!!data && data.items.length === 0} emptyText="No training records.">
        {data && (
          <>
            <Table head={['Clinician', 'Module', 'Status', 'Completed', 'Assigned']}>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{r.user_name ?? '—'}</td>
                  <td style={td()}>{r.title ?? r.module_id}</td>
                  <td style={td()}><Badge status={r.status === 'completed' ? 'completed' : 'pending'} label={r.status === 'completed' ? 'Completed' : 'Not completed'} /></td>
                  <td style={td()}>{r.completed_at ? fmtDate(r.completed_at) : '—'}</td>
                  <td style={td()}>{r.age_days === 0 ? 'today' : `${r.age_days}d ago`}</td>
                </tr>
              ))}
            </Table>
            <Pager total={data.total} offset={offset} setOffset={setOffset} />
          </>
        )}
      </StateBlock>
    </>
  );
}

export function QualityTab({ refreshKey }: Pick<TabProps, 'refreshKey'>) {
  const { data, loading, error, offset, setOffset, reload } = usePaged<QualityRow>(
    (o) => listQuality({ limit: PAGE_SIZE, offset: o }), [], refreshKey);
  return (
    <>
      <FilterBar><button style={btn()} onClick={reload}>Refresh</button></FilterBar>
      <StateBlock loading={loading && !data} error={error} empty={!!data && data.items.length === 0} emptyText="No quality scores recorded yet.">
        {data && (
          <>
            <Table head={['Clinician', 'Score', 'Period', 'Updated']}>
              {data.items.map((r) => (
                <tr key={r.user_id}>
                  <td style={td()}>{r.user_name ?? '—'}</td>
                  <td style={td()}><strong>{r.score.toFixed(1)}</strong></td>
                  <td style={td()}>{r.period_label ?? '—'}</td>
                  <td style={td()}>{timeAgo(r.updated_at)}</td>
                </tr>
              ))}
            </Table>
            <Pager total={data.total} offset={offset} setOffset={setOffset} />
          </>
        )}
      </StateBlock>
    </>
  );
}

export function AccessLogTab({ refreshKey }: Pick<TabProps, 'refreshKey'>) {
  const [which, setWhich] = useState<'records' | 'documents'>('records');
  return (
    <>
      <FilterBar>
        <div>
          <label style={label()}>Log</label>
          <select style={select()} value={which} onChange={(e) => setWhich(e.target.value as 'records' | 'documents')}>
            <option value="records">Patient-record access by clinicians</option>
            <option value="documents">Verification-document access by reviewers</option>
          </select>
        </div>
      </FilterBar>
      {which === 'records' ? <RecordAccess refreshKey={refreshKey} /> : <DocAccess refreshKey={refreshKey} />}
    </>
  );
}

function RecordAccess({ refreshKey }: { refreshKey: number }) {
  const [userId, setUserId] = useState('');
  const [applied, setApplied] = useState('');
  const { data, loading, error, offset, setOffset, reload } = usePaged<RecordAccessRow>(
    (o) => listRecordAccess({ userId: applied, limit: PAGE_SIZE, offset: o }), [applied], refreshKey);
  return (
    <>
      <FilterBar>
        <div style={{ minWidth: 260 }}>
          <label style={label()}>Clinician user id</label>
          <input style={input()} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="uuid (optional)" />
        </div>
        <button style={btn()} onClick={() => setApplied(userId)}>Apply</button>
        <button style={btn()} onClick={reload}>Refresh</button>
      </FilterBar>
      <p style={{ color: '#6b7280', fontSize: '0.78rem', marginTop: 0 }}>Read-only. Patient identifiers are masked; record contents are never shown here.</p>
      <StateBlock loading={loading && !data} error={error} empty={!!data && data.items.length === 0} emptyText="No record access logged.">
        {data && (
          <>
            <Table head={['When', 'Clinician', 'Action', 'Patient']}>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{timeAgo(r.created_at)}</td>
                  <td style={td()}>{r.user_name ?? <code style={{ fontSize: '0.75rem' }}>{r.user_id.slice(0, 8)}…</code>}</td>
                  <td style={td()}><Badge status="pending" label={r.action} /></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.patient_ref ?? '—'}</code></td>
                </tr>
              ))}
            </Table>
            <Pager total={data.total} offset={offset} setOffset={setOffset} />
          </>
        )}
      </StateBlock>
    </>
  );
}

function DocAccess({ refreshKey }: { refreshKey: number }) {
  const { data, loading, error, offset, setOffset, reload } = usePaged<DocAccessRow>(
    (o) => listDocAccess({ limit: PAGE_SIZE, offset: o }), [], refreshKey);
  return (
    <>
      <FilterBar><button style={btn()} onClick={reload}>Refresh</button></FilterBar>
      <StateBlock loading={loading && !data} error={error} empty={!!data && data.items.length === 0} emptyText="No verification-document access logged.">
        {data && (
          <>
            <Table head={['When', 'Document', 'Accessed by', 'Basis']}>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{timeAgo(r.accessed_at)}</td>
                  <td style={td()}><code style={{ fontSize: '0.75rem' }}>{r.doc_id.slice(0, 8)}…</code></td>
                  <td style={td()}><code style={{ fontSize: '0.75rem' }}>{r.accessor_id.slice(0, 8)}…</code></td>
                  <td style={td()}>{r.basis}</td>
                </tr>
              ))}
            </Table>
            <Pager total={data.total} offset={offset} setOffset={setOffset} />
          </>
        )}
      </StateBlock>
    </>
  );
}
