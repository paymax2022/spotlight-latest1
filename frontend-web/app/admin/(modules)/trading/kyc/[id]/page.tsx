'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  getKycCase, startReview, approveKyc, rejectKyc, bypassKyc, formatKobo, MAX_BYPASS_DAYS,
} from '@/services/tradingAdminService';
import type { TradingKycRecord, TradingKycEvent } from '@/types/tradingAdmin';
import {
  PageHeader, TradingTabs, Card, StatusBadge, DisclosureNote, AuditNote, PermissionBanner, BypassWarning,
  btn, btnPrimary, btnDanger, btnDisabled, input, textarea, label as lbl, fmtDate,
  TRADING_PERMS, useTradingPermission, useCurrentAdminId,
} from '../../_ui';

export default function TradingKycCasePage() {
  const params = useParams<{ id: string }>();
  const userId = params?.id ?? '';
  const { allowed: canReview } = useTradingPermission(TRADING_PERMS.review);
  const { allowed: canBypass } = useTradingPermission(TRADING_PERMS.bypass, TRADING_PERMS.bypassApprove);
  const currentAdminId = useCurrentAdminId();

  const [rec, setRec] = useState<TradingKycRecord | null>(null);
  const [events, setEvents] = useState<TradingKycEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [approveReason, setApproveReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [bpChecker, setBpChecker] = useState('');
  const [bpReason, setBpReason] = useState('');
  const [bpDays, setBpDays] = useState(14);
  const [bpCapNaira, setBpCapNaira] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const { record, events } = await getKycCase(userId); setRec(record); setEvents(events); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);

  async function act(key: string, fn: () => Promise<TradingKycRecord>, note: string) {
    setBusy(key); setMsg(null); setError(null);
    try { setRec(await fn()); setMsg(note); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  if (loading) return <div style={{ padding: '2rem' }}><p style={{ color: '#6b7280' }}>Loading…</p></div>;
  if (!rec) return <div style={{ padding: '2rem' }}><p style={{ color: '#dc2626' }}>{error ?? 'Not found'}</p></div>;

  const reviewable = rec.status === 'SUBMITTED' || rec.status === 'UNDER_REVIEW';
  const bypassable = rec.status !== 'APPROVED' && rec.status !== 'BYPASSED';
  const sameAsChecker = !!currentAdminId && bpChecker.trim() === currentAdminId;
  const capKobo = bpCapNaira.trim() ? Math.round(Number(bpCapNaira) * 100) : undefined;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title={`KYC — ${rec.display_name}`}
        subtitle="Trading Access Verification case. Approve/Reject decide access; Bypass is a two-person, time-boxed exception."
        action={<Link href="/admin/trading/kyc" style={{ ...btn(), textDecoration: 'none' }}>← Back to queue</Link>}
      />
      <TradingTabs active="kyc" />
      <DisclosureNote>Decoupled from Tier 0–3 (§16B.1). Reject requires a reason. Bypass requires a <strong>second, different</strong> approver, a written justification, and a time-box (≤ {MAX_BYPASS_DAYS} days) — logged to the compliance register.</DisclosureNote>

      {!canReview && <PermissionBanner permission={TRADING_PERMS.review} />}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <AuditNote>{msg}</AuditNote>}

      <Card title="Applicant">
        <Row k="User ID" v={<code>{rec.user_id}</code>} />
        <Row k="Status" v={<><StatusBadge status={rec.status} />{rec.reason_code ? <span style={{ color: '#9ca3af' }}> · {rec.reason_code}</span> : null}</>} />
        <Row k="Email" v={rec.email_masked} />
        <Row k="Screening" v={<>{rec.sanctions_hit ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>sanctions hit </span> : null}{rec.pep_hit ? <span style={{ color: '#9a3412', fontWeight: 600 }}>PEP </span> : null}{!rec.sanctions_hit && !rec.pep_hit ? <span style={{ color: '#15803d' }}>clear</span> : null}{rec.risk_flags?.length ? <span style={{ color: '#9ca3af' }}> · {rec.risk_flags.join(', ')}</span> : null}</>} />
        <Row k="Source of funds" v={rec.source_of_funds ?? '—'} />
        <Row k="Submitted" v={fmtDate(rec.submitted_at)} />
        {rec.status === 'BYPASSED' ? <Row k="Bypass expires" v={<><strong>{fmtDate(rec.bypass_expires_at)}</strong>{rec.exposure_cap_kobo != null ? <span style={{ color: '#9ca3af' }}> · cap {formatKobo(rec.exposure_cap_kobo)}</span> : null}</>} /> : null}
      </Card>

      {rec.status === 'SUBMITTED' && (
        <Card title="Pick up case">
          <button style={canReview && busy !== 'review' ? btnPrimary('#1d4ed8') : btnDisabled()} disabled={!canReview || busy === 'review'} onClick={() => act('review', () => startReview(userId), 'Case moved to Under Review.')}>Start review</button>
        </Card>
      )}

      {reviewable && (
        <Card title="Decision">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            <div>
              <label style={lbl()}>Approve — reason (optional)</label>
              <input style={{ ...input(), marginBottom: '0.5rem' }} value={approveReason} onChange={(e) => setApproveReason(e.target.value)} placeholder="id_verified" />
              <button style={canReview && busy !== 'approve' ? btnPrimary('#15803d') : btnDisabled()} disabled={!canReview || busy === 'approve'} onClick={() => act('approve', () => approveKyc(userId, approveReason), 'Approved — trading access granted. Audited.')}>Approve access</button>
            </div>
            <div>
              <label style={lbl()}>Reject — reason (mandatory)</label>
              <input style={{ ...input(), marginBottom: '0.5rem' }} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="doc_mismatch" />
              <button style={canReview && rejectReason.trim() && busy !== 'reject' ? btnDanger() : btnDisabled()} disabled={!canReview || !rejectReason.trim() || busy === 'reject'} onClick={() => act('reject', () => rejectKyc(userId, rejectReason.trim()), 'Rejected — access blocked; user may resubmit. Audited.')}>Reject</button>
            </div>
          </div>
          <AuditNote>Approve/Reject write an immutable trading_kyc audit event and never touch the app Tier 0–3.</AuditNote>
        </Card>
      )}

      {bypassable && (
        <Card title="Bypass (controlled exception)">
          <BypassWarning>Bypass grants trading access <em>without</em> completing verification. It is restricted to elevated roles, needs a <strong>second, different</strong> approver, a written justification, and an auto-expiry — and is surfaced on the compliance register. Prefer a reduced exposure cap while bypassed.</BypassWarning>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.9rem' }}>
            <div><label style={lbl()}>Second approver (checker) admin id</label><input style={input()} value={bpChecker} onChange={(e) => setBpChecker(e.target.value)} placeholder="different admin id" />{sameAsChecker ? <div style={{ color: '#b91c1c', fontSize: '0.72rem', marginTop: 2 }}>Must differ from you (the maker).</div> : null}</div>
            <div><label style={lbl()}>Window (days, ≤ {MAX_BYPASS_DAYS})</label><input style={input()} type="number" min={1} max={MAX_BYPASS_DAYS} value={bpDays} onChange={(e) => setBpDays(Number(e.target.value))} /></div>
            <div><label style={lbl()}>Exposure cap (₦, optional)</label><input style={input()} value={bpCapNaira} onChange={(e) => setBpCapNaira(e.target.value)} placeholder="e.g. 500000" /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={lbl()}>Justification (mandatory)</label><textarea style={textarea()} value={bpReason} onChange={(e) => setBpReason(e.target.value)} placeholder="Why is a bypass warranted, and what compensating checks were done?" /></div>
          </div>
          <div style={{ marginTop: '0.8rem' }}>
            <button
              style={canBypass && bpChecker.trim() && !sameAsChecker && bpReason.trim() && bpDays > 0 && bpDays <= MAX_BYPASS_DAYS && busy !== 'bypass' ? btnDanger() : btnDisabled()}
              disabled={!canBypass || !bpChecker.trim() || sameAsChecker || !bpReason.trim() || bpDays <= 0 || bpDays > MAX_BYPASS_DAYS || busy === 'bypass'}
              onClick={() => act('bypass', () => bypassKyc(userId, { checker_id: bpChecker.trim(), reason: bpReason.trim(), ttl_days: bpDays, exposure_cap_kobo: capKobo }), 'Bypass granted (two-person) — logged to the compliance register with auto-expiry.')}
            >Grant bypass</button>
          </div>
        </Card>
      )}

      <Card title="Audit trail">
        {events.length === 0 ? <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No events recorded.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {events.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.6rem', fontSize: '0.8rem', alignItems: 'baseline' }}>
                <span style={{ color: '#9ca3af', minWidth: 150 }}>{fmtDate(e.created_at)}</span>
                <span style={{ fontWeight: 600 }}>{e.event_type}</span>
                <span style={{ color: '#6b7280' }}>{e.old_status ? `${e.old_status} → ` : ''}{e.new_status}{e.reason ? ` · ${e.reason}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: '0.75rem', padding: '0.3rem 0', fontSize: '0.85rem' }}><div style={{ width: 140, color: '#6b7280', fontWeight: 600 }}>{k}</div><div style={{ color: '#374151' }}>{v}</div></div>;
}
