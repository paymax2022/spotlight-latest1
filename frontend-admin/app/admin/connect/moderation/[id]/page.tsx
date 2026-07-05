'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getModerationCase } from '@/services/connectAdminService';
import type { ModerationCaseDetail } from '@/types/connectAdmin';
import { PageHeader, Card, Badge, th, td } from '../../_ui';

export default function ConnectModerationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [c, setC] = useState<ModerationCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() { setLoading(true); setError(null); try { setC(await getModerationCase(id)); } catch (e) { setError(String(e)); } finally { setLoading(false); } }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (loading) return <div style={{ padding: '0.5rem' }}><p style={{ color: '#6b7280' }}>Loading…</p></div>;
  if (error || !c) return <div style={{ padding: '0.5rem' }}><p style={{ color: '#dc2626' }}>{error ?? 'Not found'}</p><Link href="/admin/connect/moderation" style={{ color: '#1d4ed8' }}>← Back</Link></div>;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <Link href="/admin/connect/moderation" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>← Moderation queue</Link>
      <div style={{ height: 8 }} />
      <PageHeader title={`Report — ${c.case_id}`} subtitle={`${c.content_type} · reported ${new Date(c.created_at).toLocaleString('en-NG')}`} />

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Badge status={c.severity} />
        <Badge status={c.status === 'actioned' ? 'resolved' : c.status === 'dismissed' ? 'closed' : c.status} />
        <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>AI confidence: <strong>{Math.round(c.ai_confidence * 100)}%</strong></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <Card title="Report">
          <KV k="Reason" v={c.reason} />
          <KV k="Subject" v={c.subject_id} />
          <KV k="Reporter" v={c.reporter_id ?? 'system / AI'} />
          <KV k="Evidence" v={c.evidence_ref} />
          <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#9ca3af' }}>Evidence is a vault pointer — raw content is not rendered in the console.</div>
        </Card>

        <Card title="AI moderation reason codes">
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {c.ai_reason_codes.length ? c.ai_reason_codes.map((code) => <Badge key={code} status="high" label={code} />) : <span style={{ color: '#9ca3af' }}>No AI codes</span>}
          </div>
          {c.notes ? <p style={{ fontSize: '0.85rem', color: '#374151', marginTop: '0.75rem' }}>{c.notes}</p> : null}
        </Card>
      </div>

      <Card title="History">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th()}>When</th><th style={th()}>Actor</th><th style={th()}>Action</th><th style={th()}>Note</th></tr></thead>
          <tbody>
            {c.history.map((h, i) => (
              <tr key={i}><td style={td()}>{new Date(h.at).toLocaleString('en-NG')}</td><td style={td()}>{h.actor}</td><td style={td()}><code style={{ fontSize: '0.78rem' }}>{h.action}</code></td><td style={td()}>{h.note ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem', gap: '1rem' }}>
      <span style={{ color: '#6b7280' }}>{k}</span>
      <span style={{ fontWeight: 600, wordBreak: 'break-all', textAlign: 'right' }}>{v}</span>
    </div>
  );
}
