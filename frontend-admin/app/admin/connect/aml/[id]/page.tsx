'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getAmlCase, fileStr, formatNaira } from '@/services/connectAdminService';
import type { AmlCaseDetail } from '@/types/connectAdmin';
import { PageHeader, Card, Badge, btn, th, td } from '../../_ui';
import { ConfirmDialog } from '@/components/rbac/ConfirmDialog';

export default function ConnectAmlCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [c, setC] = useState<AmlCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [narrativeRef, setNarrativeRef] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function load() { setLoading(true); setError(null); try { setC(await getAmlCase(id)); } catch (e) { setError(String(e)); } finally { setLoading(false); } }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  // Confirm gate: validate the filing inputs, then require an explicit reaffirm in
  // the ConfirmDialog before the (irreversible, regulatory) STR is filed.
  function askFileStr() {
    if (!reasonCode.trim() || !narrativeRef.trim()) { setError('Reason code and narrative reference are required to file an STR.'); return; }
    setError(null); setConfirmOpen(true);
  }

  async function submitStr() {
    if (!reasonCode.trim() || !narrativeRef.trim()) { setError('Reason code and narrative reference are required to file an STR.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fileStr(id, { reason_code: reasonCode.trim(), narrative_ref: narrativeRef.trim() });
      setFiled(res.str_reference);
      setConfirmOpen(false);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  if (loading) return <div style={{ padding: '0.5rem' }}><p style={{ color: '#6b7280' }}>Loading…</p></div>;
  if (error && !c) return <div style={{ padding: '0.5rem' }}><p style={{ color: '#dc2626' }}>{error}</p><Link href="/admin/connect/aml" style={{ color: '#1d4ed8' }}>← Back</Link></div>;
  if (!c) return null;

  const alreadyFiled = c.status === 'str_filed' || c.str_reference || filed;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <Link href="/admin/connect/aml" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>← AML queue</Link>
      <div style={{ height: 8 }} />
      <PageHeader title={`AML case — ${c.id}`} subtitle={`${c.rule.replace(/_/g, ' ')} · subject ${c.subject_id}`} />

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Badge status={c.severity} />
        <Badge status={c.status === 'cleared' ? 'resolved' : c.status === 'escalated' ? 'critical' : c.status === 'str_filed' ? 'closed' : c.status} label={c.status.replace(/_/g, ' ')} />
      </div>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <Card title="Alert (reason codes only — no raw PII)">
          <KV k="Rule" v={c.rule.replace(/_/g, ' ')} />
          <KV k="Subject" v={c.subject_id} />
          <KV k="Window txns" v={String(c.window_txn_count)} />
          <KV k="Window volume" v={formatNaira(c.window_volume_kobo)} />
          <KV k="Trigger amount" v={c.amount_kobo ? formatNaira(c.amount_kobo) : '—'} />
          <div style={{ marginTop: '0.65rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {c.reason_codes.map((rc) => <Badge key={rc} status="high" label={rc} />)}
          </div>
          {c.notes ? <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginTop: '0.65rem' }}>{c.notes}</p> : null}
        </Card>

        <Card title="STR / SAR filing (NFIU — 24h)">
          {alreadyFiled ? (
            <div>
              <Badge status="resolved" label="STR filed" />
              <p style={{ fontSize: '0.9rem', marginTop: '0.6rem' }}>Reference: <code>{filed ?? c.str_reference}</code></p>
              {c.str_filed_at ? <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>Filed {new Date(c.str_filed_at).toLocaleString('en-NG')}</p> : null}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', color: '#374151' }}>
                AML reason code
                <input value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="e.g. STRUCT_SUB_THRESHOLD" style={inputStyle} />
              </label>
              <label style={{ fontSize: '0.8rem', color: '#374151' }}>
                Narrative reference (vault pointer)
                <input value={narrativeRef} onChange={(e) => setNarrativeRef(e.target.value)} placeholder="vault://str/narrative-id" style={inputStyle} />
              </label>
              <button disabled={busy} onClick={askFileStr} style={{ ...btn(), background: '#340075', color: '#fff', borderColor: '#340075', marginTop: '0.35rem' }}>{busy ? 'Filing…' : 'File STR with NFIU'}</button>
              <p style={{ fontSize: '0.75rem', color: '#9ca3af', margin: 0 }}>Action is audited. Reason codes only — no raw PII in the filing record.</p>
            </div>
          )}
        </Card>
      </div>

      <Card title="History">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th()}>When</th><th style={th()}>Actor</th><th style={th()}>Action</th><th style={th()}>Reason code</th></tr></thead>
          <tbody>
            {c.history.map((h, i) => (
              <tr key={i}><td style={td()}>{new Date(h.at).toLocaleString('en-NG')}</td><td style={td()}>{h.actor}</td><td style={td()}><code style={{ fontSize: '0.78rem' }}>{h.action}</code></td><td style={td()}>{h.reason_code ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        level="critical"
        title={`File STR with NFIU — case ${c.id}`}
        description={`Reason code ${reasonCode.trim() || '—'} · narrative ${narrativeRef.trim() || '—'}. Reason codes only — no raw PII is written to the filing record.`}
        reasons={[
          'Files a regulatory report (STR/SAR) with the NFIU — this cannot be undone.',
          'Should require a second compliance approver — pending backend support.',
          'Recorded in the audit log with your name, reason and timestamp.',
        ]}
        requireReason
        reasonLabel="Filing justification (recorded in the audit log)"
        reasonPlaceholder="Basis for filing this STR (e.g. structuring below threshold confirmed, escalation ref)…"
        busy={busy}
        confirmLabel="File STR"
        onConfirm={() => { void submitStr(); }}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </div>
  );
}

const inputStyle = { display: 'block', width: '100%', marginTop: '0.25rem', padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' } as const;

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem', gap: '1rem' }}>
      <span style={{ color: '#6b7280', textTransform: 'capitalize' }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
    </div>
  );
}
