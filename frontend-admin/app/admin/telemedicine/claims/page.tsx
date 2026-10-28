'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getClaimsSummary, listClaims, getClaim, reviewClaim, listPreAuth, getPreAuth, listFraudWarnings, acknowledgeFraudWarning, formatNaira,
  type ClaimsSummary, type HmoClaim, type HmoClaimDetail, type PreAuth, type PreAuthDetail, type FraudWarning, type Page,
} from '@/services/telemedAdminClaimsService';
import { PageHeader, TelemedTabs, Card, Kpi, Badge, DisclosureNote, AuditNote, StateBlock, FilterBar, btn, btnPrimary, th, td, input, label, select, fmtDate, timeAgo } from '../_ui';
import { colors } from '@/components/ui/vuexy';
import { Drawer, Rows, DetailJson, Pager, SubTabs, humanize } from './_parts';

type Tab = 'claims' | 'preauth' | 'fraud';
const PAGE_SIZE = 20;
const CLAIM_STATUSES = ['submitted', 'under_review', 'approved', 'partially_approved', 'rejected', 'paid', 'disputed'];
const PREAUTH_STATUSES = ['pending', 'approved', 'rejected'];

const empty = <T,>(): Page<T> => ({ items: [], total: 0, limit: PAGE_SIZE, offset: 0 });

export default function ClaimsConsolePage() {
  const [tab, setTab] = useState<Tab>('claims');
  const [summary, setSummary] = useState<ClaimsSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try { setSummary(await getClaimsSummary()); setSummaryError(null); }
    catch (e) { setSummaryError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const awaiting = (summary?.claims_by_status.submitted ?? 0) + (summary?.claims_by_status.under_review ?? 0);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="HMO claims & pre-authorisation"
        subtitle="Oversight of claims, pre-authorisation requests and fraud warnings raised from the doctor app. Claims settle with the HMO, never through the platform ledger."
        action={<button onClick={loadSummary} style={btn()}>Refresh</button>}
      />
      <TelemedTabs active="claims" />
      <DisclosureNote>
        Patient identities are masked. Reviewing a claim records a note and never changes its status; acknowledging a fraud warning marks it
        seen. Both actions are written to the immutable compliance audit trail (requires telemedicine.admin.manage).
      </DisclosureNote>

      {summaryError ? <p style={{ color: '#dc2626' }}>Could not load totals: {summaryError}</p> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Claims" value={(summary?.claims_total ?? 0).toLocaleString('en-NG')} sub={`${awaiting} awaiting HMO`} accent="#340075" />
        <Kpi label="Claimed value" value={formatNaira(summary?.claims_amount_kobo ?? 0)} sub="Reporting only — no ledger posting" />
        <Kpi label="Disputed" value={(summary?.claims_by_status.disputed ?? 0).toLocaleString('en-NG')} accent={(summary?.claims_by_status.disputed ?? 0) > 0 ? '#9a3412' : undefined} />
        <Kpi label="Pre-auth requests" value={(summary?.preauth_total ?? 0).toLocaleString('en-NG')} sub={`${summary?.preauth_by_status.pending ?? 0} pending`} />
        <Kpi label="Open fraud warnings" value={(summary?.fraud_warnings_open ?? 0).toLocaleString('en-NG')} sub={`${summary?.fraud_warnings_high_open ?? 0} high / critical`} accent={(summary?.fraud_warnings_open ?? 0) > 0 ? '#b91c1c' : undefined} />
      </div>

      <SubTabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'claims', label: 'Claims', count: summary?.claims_total },
          { key: 'preauth', label: 'Pre-auth', count: summary?.preauth_total },
          { key: 'fraud', label: 'Fraud warnings', count: summary?.fraud_warnings_open },
        ]}
      />

      {tab === 'claims' && <ClaimsTab onChanged={loadSummary} />}
      {tab === 'preauth' && <PreAuthTab />}
      {tab === 'fraud' && <FraudTab onChanged={loadSummary} />}
    </div>
  );
}

// ── Claims ────────────────────────────────────────────────────────────────

function ClaimsTab({ onChanged }: { onChanged: () => void }) {
  const [page, setPage] = useState<Page<HmoClaim>>(empty());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setPage(await listClaims({ status: status || undefined, q: q.trim() || undefined, limit: PAGE_SIZE, offset })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
    // q is applied on Enter / Apply only, via apply()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, offset]);
  useEffect(() => { load(); }, [load]);

  const apply = () => { if (offset === 0) load(); else setOffset(0); };

  return (
    <>
      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Claim ref, clinician or id…" value={q} maxLength={64} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value); }}>
            <option value="">All</option>
            {CLAIM_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
        </div>
        <button style={btn()} onClick={apply}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={page.items.length === 0} emptyText="No claims match these filters.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Claim</th><th style={th()}>Clinician</th><th style={th()}>Patient</th>
              <th style={th()}>Amount</th><th style={th()}>Status</th><th style={th()}>Submitted</th><th style={th()} />
            </tr></thead>
            <tbody>
              {page.items.map((c) => (
                <tr key={c.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{c.ref ?? c.id.slice(0, 8)}</code></td>
                  <td style={td()}>{c.doctor_name}</td>
                  <td style={td()}>{c.patient_masked}</td>
                  <td style={td()}>{formatNaira(c.amount_kobo)}</td>
                  <td style={td()}><Badge status={c.status} /></td>
                  <td style={td()}>{fmtDate(c.created_at)}</td>
                  <td style={td()}><button style={btn()} onClick={() => setOpenId(c.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={page.total} offset={offset} limit={PAGE_SIZE} onPage={setOffset} />
        </StateBlock>
      </Card>

      {openId && <ClaimDrawer id={openId} onClose={() => setOpenId(null)} onSaved={() => { load(); onChanged(); }} />}
    </>
  );
}

function ClaimDrawer({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [claim, setClaim] = useState<HmoClaimDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setClaim(null); setError(null);
    getClaim(id).then((c) => { if (live) setClaim(c); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [id]);

  async function submit() {
    setBusy(true); setError(null);
    try { setClaim(await reviewClaim(id, note.trim())); setNote(''); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const tooShort = note.trim().length < 3;
  return (
    <Drawer title={claim ? `Claim ${claim.ref ?? claim.id.slice(0, 8)}` : 'Claim'} onClose={onClose}>
      {!claim && !error && <p style={{ color: colors.muted }}>Loading…</p>}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {claim && (
        <>
          <Rows rows={[
            ['Status', <Badge key="s" status={claim.status} />],
            ['Clinician', claim.doctor_name],
            ['Patient', claim.patient_masked],
            ['Amount claimed', formatNaira(claim.amount_kobo)],
            ['Appointment', claim.appointment_id ? <code key="a">{claim.appointment_id}</code> : '—'],
            ['Submitted', fmtDate(claim.created_at)],
            ['Last updated', timeAgo(claim.updated_at)],
          ]} />
          <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.4rem' }}>Claim detail</h3>
          <DetailJson detail={claim.detail} />

          <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.4rem' }}>Admin review</h3>
          <textarea
            style={{ ...input(), width: '100%', minHeight: 80, resize: 'vertical' }}
            placeholder="Record what you checked (3–1000 characters)…"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '0.5rem 0 1rem' }}>
            <button style={btnPrimary()} disabled={busy || tooShort} onClick={submit}>{busy ? 'Saving…' : 'Save review note'}</button>
            <AuditNote>Recorded to the compliance audit log.</AuditNote>
          </div>

          <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.4rem' }}>Audit trail</h3>
          {claim.audit.length === 0 ? <p style={{ color: colors.muted, fontSize: '0.82rem' }}>No admin actions recorded yet.</p> : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.82rem' }}>
              {claim.audit.map((a) => (
                <li key={a.id} style={{ borderTop: `1px solid ${colors.border}`, padding: '0.45rem 0' }}>
                  <strong>{a.note || humanize(a.action)}</strong>
                  <div style={{ color: colors.muted }}>{timeAgo(a.created_at)} · reviewer <code>{a.actor_id.slice(0, 8)}</code></div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Drawer>
  );
}

// ── Pre-auth ──────────────────────────────────────────────────────────────

function PreAuthTab() {
  const [page, setPage] = useState<Page<PreAuth>>(empty());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<PreAuthDetail | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setPage(await listPreAuth({ status: status || undefined, q: q.trim() || undefined, limit: PAGE_SIZE, offset })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, offset]);
  useEffect(() => { load(); }, [load]);

  const apply = () => { if (offset === 0) load(); else setOffset(0); };
  async function view(id: string) {
    setOpen(null); setOpenError(null);
    try { setOpen(await getPreAuth(id)); } catch (e) { setOpenError(e instanceof Error ? e.message : String(e)); }
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
            {PREAUTH_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
        </div>
        <button style={btn()} onClick={apply}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={page.items.length === 0} emptyText="No pre-authorisation requests match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Request</th><th style={th()}>Clinician</th><th style={th()}>Patient</th><th style={th()}>Amount</th>
              <th style={th()}>Auth code</th><th style={th()}>Status</th><th style={th()}>Requested</th><th style={th()} />
            </tr></thead>
            <tbody>
              {page.items.map((p) => (
                <tr key={p.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{p.id.slice(0, 8)}</code></td>
                  <td style={td()}>{p.doctor_name}</td>
                  <td style={td()}>{p.patient_masked}</td>
                  <td style={td()}>{formatNaira(p.amount_kobo)}</td>
                  <td style={td()}>{p.auth_code_present ? 'Issued' : '—'}</td>
                  <td style={td()}><Badge status={p.status} /></td>
                  <td style={td()}>{fmtDate(p.created_at)}</td>
                  <td style={td()}><button style={btn()} onClick={() => view(p.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={page.total} offset={offset} limit={PAGE_SIZE} onPage={setOffset} />
        </StateBlock>
      </Card>

      {(open || openError) && (
        <Drawer title="Pre-authorisation request" onClose={() => { setOpen(null); setOpenError(null); }}>
          {openError && <p style={{ color: '#dc2626' }}>{openError}</p>}
          {open && (
            <>
              <Rows rows={[
                ['Status', <Badge key="s" status={open.status} />],
                ['Clinician', open.doctor_name],
                ['Patient', open.patient_masked],
                ['Amount', formatNaira(open.amount_kobo)],
                ['Auth code', open.auth_code_present ? 'Issued by the HMO (hidden)' : 'Not issued'],
                ['Appointment', open.appointment_id ? <code key="a">{open.appointment_id}</code> : '—'],
                ['Requested', fmtDate(open.created_at)],
                ['Last updated', timeAgo(open.updated_at)],
              ]} />
              <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.4rem' }}>Request detail</h3>
              <DetailJson detail={open.detail} />
            </>
          )}
        </Drawer>
      )}
    </>
  );
}

// ── Fraud warnings ────────────────────────────────────────────────────────

function FraudTab({ onChanged }: { onChanged: () => void }) {
  const [page, setPage] = useState<Page<FraudWarning>>(empty());
  const [state, setState] = useState<'open' | 'acknowledged' | 'all'>('open');
  const [severity, setSeverity] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setPage(await listFraudWarnings({
        acknowledged: state === 'all' ? undefined : state === 'acknowledged',
        severity: severity || undefined, limit: PAGE_SIZE, offset,
      }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [state, severity, offset]);
  useEffect(() => { load(); }, [load]);

  async function ack(w: FraudWarning) {
    setBusyId(w.id); setError(null);
    try { await acknowledgeFraudWarning(w.id); await load(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(null); }
  }

  return (
    <>
      <FilterBar>
        <div>
          <label style={label()}>Show</label>
          <select style={select()} value={state} onChange={(e) => { setOffset(0); setState(e.target.value as typeof state); }}>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="all">All</option>
          </select>
        </div>
        <div>
          <label style={label()}>Severity</label>
          <select style={select()} value={severity} onChange={(e) => { setOffset(0); setSeverity(e.target.value); }}>
            <option value="">Any</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={page.items.length === 0} emptyText="No fraud warnings in this view.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Clinician</th><th style={th()}>Severity</th><th style={th()}>Warning</th>
              <th style={th()}>Raised</th><th style={th()}>State</th><th style={th()} />
            </tr></thead>
            <tbody>
              {page.items.map((w) => (
                <tr key={w.id}>
                  <td style={td()}>{w.doctor_name}</td>
                  <td style={td()}><Badge status={w.severity.toLowerCase()} /></td>
                  <td style={td()}>{w.summary || <span style={{ color: colors.muted }}>No summary on file</span>}</td>
                  <td style={td()}>{timeAgo(w.created_at)}</td>
                  <td style={td()}>{w.acknowledged ? <Badge status="resolved" label={`Acknowledged ${w.acknowledged_at ? fmtDate(w.acknowledged_at) : ''}`} /> : <Badge status="pending" label="Open" />}</td>
                  <td style={td()}>
                    {!w.acknowledged && <button style={btn()} disabled={busyId === w.id} onClick={() => ack(w)}>{busyId === w.id ? 'Saving…' : 'Acknowledge'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={page.total} offset={offset} limit={PAGE_SIZE} onPage={setOffset} />
        </StateBlock>
      </Card>
    </>
  );
}
