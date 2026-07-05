'use client';

// 9.K — Documents repository + templates (presigned upload).

import { useEffect, useState } from 'react';
import { listDocuments, presignDocument } from '@/services/fractionalreAdminService';
import type { DocumentRecord } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Badge, btn, btnPrimary, th, td, input, label, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Documents" subtitle="Versioned repository, templates and signed acknowledgements." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FractionalReTabs active="documents" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <p style={{ color: '#15803d', wordBreak: 'break-all' }}>{msg}</p>}

      <Card title="Upload document (presigned)">
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ width: 280 }}><label style={label()}>File name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Valuation Report Q3.pdf" style={input()} /></div>
          <div style={{ width: 180 }}><label style={label()}>Kind</label><select value={kind} onChange={(e) => setKind(e.target.value)} style={input()}>{['title', 'valuation', 'insurance', 'deed', 'consent', 'survey', 'agreement', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
          <button onClick={presign} disabled={working || !name} style={{ ...btnPrimary(), opacity: working || !name ? 0.6 : 1 }}>{working ? 'Requesting…' : 'Get upload URL'}</button>
        </div>
      </Card>

      <Card title="Repository">
        {loading ? <p style={{ color: '#6b7280' }}>Loading documents…</p> : repo.length === 0 ? <p style={{ color: '#6b7280' }}>No documents.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Name</th><th style={th()}>Kind</th><th style={th()}>Asset</th><th style={th()}>Version</th><th style={th()}>Signed</th><th style={th()}>Uploaded</th></tr></thead>
            <tbody>{repo.map((d) => (
              <tr key={d.id}><td style={td()}>{d.name}</td><td style={{ ...td(), textTransform: 'capitalize' }}>{d.kind}</td><td style={td()}>{d.assetId ?? '—'}</td><td style={td()}>v{d.version}</td><td style={td()}>{d.signed ? <Badge status="verified" label="signed" /> : <Badge status="pending" label="unsigned" />}</td><td style={td()}>{timeAgo(d.uploadedAt)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <Card title="Templates">
        {templates.length === 0 ? <p style={{ color: '#6b7280' }}>No templates.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Name</th><th style={th()}>Version</th><th style={th()}>Updated</th></tr></thead>
            <tbody>{templates.map((d) => (<tr key={d.id}><td style={td()}>{d.name}</td><td style={td()}>v{d.version}</td><td style={td()}>{timeAgo(d.uploadedAt)}</td></tr>))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
