'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getModerationCase } from '@/services/connectAdminService';
import type { ModerationCaseDetail } from '@/types/connectAdmin';
import { Page, PageHeader, Card, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function severityColor(severity: string): string {
  if (severity === 'critical' || severity === 'high') return colors.danger;
  if (severity === 'normal') return colors.info;
  return colors.secondary;
}

export default function ConnectModerationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [c, setC] = useState<ModerationCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() { setLoading(true); setError(null); try { setC(await getModerationCase(id)); } catch (e) { setError(String(e)); } finally { setLoading(false); } }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (loading) return <Page><p style={{ color: colors.muted }}>Loading…</p></Page>;
  if (error || !c) return <Page><p style={{ color: colors.danger }}>{error ?? 'Not found'}</p><Link href="/admin/connect/moderation" style={{ color: colors.info }}>← Back</Link></Page>;

  return (
    <Page>
      <Link href="/admin/connect/moderation" style={{ color: colors.info, textDecoration: 'none', fontSize: '0.85rem' }}>← Moderation queue</Link>
      <div style={{ height: 8 }} />
      <PageHeader title={`Report — ${c.case_id}`} subtitle={`${c.content_type} · reported ${new Date(c.created_at).toLocaleString('en-NG')}`} />

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Badge text={c.severity} color={severityColor(c.severity)} />
        <Badge text={c.status === 'actioned' ? 'resolved' : c.status === 'dismissed' ? 'closed' : c.status} color={c.status === 'actioned' ? colors.success : c.status === 'dismissed' ? colors.secondary : colors.warning} />
        <span style={{ fontSize: '0.85rem', color: colors.muted }}>AI confidence: <strong>{Math.round(c.ai_confidence * 100)}%</strong></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <Card title="Report">
          <KV k="Reason" v={c.reason} />
          <KV k="Subject" v={c.subject_id} />
          <KV k="Reporter" v={c.reporter_id ?? 'system / AI'} />
          <KV k="Evidence" v={c.evidence_ref} />
          <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: colors.muted }}>Evidence is a vault pointer — raw content is not rendered in the console.</div>
        </Card>

        <Card title="AI moderation reason codes">
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {c.ai_reason_codes.length ? c.ai_reason_codes.map((code) => <Badge key={code} text={code} color={colors.warning} />) : <span style={{ color: colors.muted }}>No AI codes</span>}
          </div>
          {c.notes ? <p style={{ fontSize: '0.85rem', color: colors.text, marginTop: '0.75rem' }}>{c.notes}</p> : null}
        </Card>
      </div>

      <Card title="History">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={thCell}>When</th><th style={thCell}>Actor</th><th style={thCell}>Action</th><th style={thCell}>Note</th></tr></thead>
          <tbody>
            {c.history.map((h, i) => (
              <tr key={i}><td style={tdCell}>{new Date(h.at).toLocaleString('en-NG')}</td><td style={tdCell}>{h.actor}</td><td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{h.action}</code></td><td style={tdCell}>{h.note ?? '—'}</td></tr>
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
      <span style={{ color: colors.muted }}>{k}</span>
      <span style={{ fontWeight: 600, wordBreak: 'break-all', textAlign: 'right' }}>{v}</span>
    </div>
  );
}
