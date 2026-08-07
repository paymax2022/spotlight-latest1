'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getAmlCase, fileStr, formatNaira } from '@/services/connectAdminService';
import type { AmlCaseDetail } from '@/types/connectAdmin';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function severityColor(sev: string): string {
  if (sev === 'critical') return colors.danger;
  if (sev === 'high') return colors.warning;
  return colors.info;
}

function statusColor(status: string): string {
  if (status === 'cleared') return colors.success;
  if (status === 'str_filed') return colors.secondary;
  if (status === 'escalated') return colors.danger;
  return colors.info;
}

export default function ConnectAmlCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [c, setC] = useState<AmlCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [narrativeRef, setNarrativeRef] = useState('');

  async function load() { setLoading(true); setError(null); try { setC(await getAmlCase(id)); } catch (e) { setError(String(e)); } finally { setLoading(false); } }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function submitStr() {
    if (!reasonCode.trim() || !narrativeRef.trim()) { setError('Reason code and narrative reference are required to file an STR.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fileStr(id, { reason_code: reasonCode.trim(), narrative_ref: narrativeRef.trim() });
      setFiled(res.str_reference);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  if (loading) return <Page><p style={{ color: colors.muted }}>Loading…</p></Page>;
  if (error && !c) return <Page><p style={{ color: colors.danger }}>{error}</p><Link href="/admin/connect/aml" style={{ color: colors.primary }}>← Back</Link></Page>;
  if (!c) return null;

  const alreadyFiled = c.status === 'str_filed' || c.str_reference || filed;

  return (
    <Page>
      <Link href="/admin/connect/aml" style={{ color: colors.primary, textDecoration: 'none', fontSize: '0.85rem' }}>← AML queue</Link>
      <div style={{ height: 8 }} />
      <PageHeader title={`AML case — ${c.id}`} subtitle={`${c.rule.replace(/_/g, ' ')} · subject ${c.subject_id}`} />

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Badge text={c.severity} color={severityColor(c.severity)} />
        <Badge text={c.status.replace(/_/g, ' ')} color={statusColor(c.status)} />
      </div>

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <Card title="Alert (reason codes only — no raw PII)">
          <div style={{ marginTop: 12 }}>
            <KV k="Rule" v={c.rule.replace(/_/g, ' ')} />
            <KV k="Subject" v={c.subject_id} />
            <KV k="Window txns" v={String(c.window_txn_count)} />
            <KV k="Window volume" v={formatNaira(c.window_volume_kobo)} />
            <KV k="Trigger amount" v={c.amount_kobo ? formatNaira(c.amount_kobo) : '—'} />
          </div>
          <div style={{ marginTop: '0.65rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {c.reason_codes.map((rc) => <Badge key={rc} text={rc} color={colors.warning} />)}
          </div>
          {c.notes ? <p style={{ fontSize: '0.8rem', color: colors.muted, marginTop: '0.65rem' }}>{c.notes}</p> : null}
        </Card>

        <Card title="STR / SAR filing (NFIU — 24h)">
          {alreadyFiled ? (
            <div style={{ marginTop: 12 }}>
              <Badge text="STR filed" color={colors.success} />
              <p style={{ fontSize: '0.9rem', marginTop: '0.6rem' }}>Reference: <code>{filed ?? c.str_reference}</code></p>
              {c.str_filed_at ? <p style={{ fontSize: '0.8rem', color: colors.muted }}>Filed {new Date(c.str_filed_at).toLocaleString('en-NG')}</p> : null}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: 12 }}>
              <label style={{ fontSize: '0.8rem', color: colors.text }}>
                AML reason code
                <Input value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="e.g. STRUCT_SUB_THRESHOLD" style={{ display: 'block', width: '100%', marginTop: '0.25rem' }} />
              </label>
              <label style={{ fontSize: '0.8rem', color: colors.text }}>
                Narrative reference (vault pointer)
                <Input value={narrativeRef} onChange={(e) => setNarrativeRef(e.target.value)} placeholder="vault://str/narrative-id" style={{ display: 'block', width: '100%', marginTop: '0.25rem' }} />
              </label>
              <Button variant="primary" disabled={busy} onClick={submitStr} style={{ marginTop: '0.35rem' }}>{busy ? 'Filing…' : 'File STR with NFIU'}</Button>
              <p style={{ fontSize: '0.75rem', color: colors.muted, margin: 0 }}>Action is audited. Reason codes only — no raw PII in the filing record.</p>
            </div>
          )}
        </Card>
      </div>

      <Card title="History" style={{ marginTop: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={thCell}>When</th><th style={thCell}>Actor</th><th style={thCell}>Action</th><th style={thCell}>Reason code</th></tr></thead>
          <tbody>
            {c.history.map((h, i) => (
              <tr key={i}><td style={tdCell}>{new Date(h.at).toLocaleString('en-NG')}</td><td style={tdCell}>{h.actor}</td><td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{h.action}</code></td><td style={tdCell}>{h.reason_code ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: `1px solid ${colors.border}`, fontSize: '0.85rem', gap: '1rem' }}>
      <span style={{ color: colors.muted, textTransform: 'capitalize' }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
    </div>
  );
}
