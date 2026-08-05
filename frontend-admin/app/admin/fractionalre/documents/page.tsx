'use client';

// 9.K — Documents repository + templates (presigned upload).

import { useEffect, useState } from 'react';
import { listDocuments, presignDocument } from '@/services/fractionalreAdminService';
import type { DocumentRecord } from '@/types/fractionalreAdmin';
import { FractionalReTabs, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const labelStyle = { fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'block', marginBottom: 4 } as const;

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('title');

  async function load() {
    setLoading(true); setError(null);
    try { setDocs(await listDocuments()); } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function presign() {
    if (!name) return;
    setWorking(true); setError(null); setMsg(null);
    try { const r = await presignDocument(name, kind); setMsg(`Presigned upload URL issued (expires ${timeAgo(r.expiresAt)}). Upload to: ${r.uploadUrl}`); setName(''); }
    catch (e) { setError(String(e)); } finally { setWorking(false); }
  }

  const repo = docs.filter((d) => d.kind !== 'template');
  const templates = docs.filter((d) => d.kind === 'template');

  return (
    <Page>
      <PageHeader title="Documents" subtitle="Versioned repository, templates and signed acknowledgements." actions={<Button onClick={load}>Refresh</Button>} />
      <FractionalReTabs active="documents" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <p style={{ color: colors.success, wordBreak: 'break-all' }}>{msg}</p>}

      <Card title="Upload document (presigned)">
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ width: 280 }}><label style={labelStyle}>File name</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Valuation Report Q3.pdf" /></div>
          <div style={{ width: 180 }}><label style={labelStyle}>Kind</label><select value={kind} onChange={(e) => setKind(e.target.value)} className="vx-input">{['title', 'valuation', 'insurance', 'deed', 'consent', 'survey', 'agreement', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
          <Button variant="primary" onClick={presign} disabled={working || !name}>{working ? 'Requesting…' : 'Get upload URL'}</Button>
        </div>
      </Card>

      <Card title="Repository">
        {loading ? <p style={{ color: colors.muted }}>Loading documents…</p> : repo.length === 0 ? <p style={{ color: colors.muted }}>No documents.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Name</th><th style={thCell}>Kind</th><th style={thCell}>Asset</th><th style={thCell}>Version</th><th style={thCell}>Signed</th><th style={thCell}>Uploaded</th></tr></thead>
            <tbody>{repo.map((d) => (
              <tr key={d.id}><td style={tdCell}>{d.name}</td><td style={{ ...tdCell, textTransform: 'capitalize' }}>{d.kind}</td><td style={tdCell}>{d.assetId ?? '—'}</td><td style={tdCell}>v{d.version}</td><td style={tdCell}>{d.signed ? <Badge text="signed" color={colors.success} /> : <Badge text="unsigned" color={colors.warning} />}</td><td style={tdCell}>{timeAgo(d.uploadedAt)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <Card title="Templates">
        {templates.length === 0 ? <p style={{ color: colors.muted }}>No templates.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Name</th><th style={thCell}>Version</th><th style={thCell}>Updated</th></tr></thead>
            <tbody>{templates.map((d) => (<tr key={d.id}><td style={tdCell}>{d.name}</td><td style={tdCell}>v{d.version}</td><td style={tdCell}>{timeAgo(d.uploadedAt)}</td></tr>))}</tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
