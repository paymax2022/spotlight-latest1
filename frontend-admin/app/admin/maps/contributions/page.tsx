'use client';

import { useEffect, useState } from 'react';
import { listContributions, reviewContribution } from '@/services/mapServiceAdminService';
import type { ContributionCandidate, ContributionReviewAction } from '@/types/mapServiceAdmin';
import {
  PageHeader, MapsTabs, Card, Badge, DisclosureNote, AuditNote, StateBlock,
  btn, btnPrimary, btnDanger, th, td, input, label, fmtDate,
} from '../_ui';

function truncate(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export default function MapsContributionsPage() {
  const [items, setItems] = useState<ContributionCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ContributionCandidate | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setItems(await listContributions('pending')); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function review(item: ContributionCandidate) {
    setOpen(item);
    setNotes('');
    setMsg(null);
  }

  async function decide(action: ContributionReviewAction) {
    if (!open) return;
    setBusy(true); setMsg(null);
    try {
      const r = await reviewContribution(open.id, { action, ...(notes ? { notes } : {}) });
      setMsg(`Candidate ${r.id} ${r.status}.`);
      setOpen(null);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="OSM Contribution Review"
        subtitle="Confirmed pins and geometry improvements queued for OpenStreetMap. Ops reviews each candidate before it is uploaded — approvals are pushed to OSM, rejections stay internal."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <MapsTabs active="contributions" />

      <DisclosureNote>
        <strong>Only non-PII improvements reach OSM; PII stays in the private gazetteer.</strong> A candidate flagged as
        not PII-stripped must not be uploaded — reject it, or send it back for stripping. Approving uploads the geometry
        to OpenStreetMap under your reviewer identity.
      </DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card title="Pending candidates">
        <StateBlock loading={loading} error={error} empty={items.length === 0} emptyText="No pending contribution candidates.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Type</th>
              <th style={th()}>H3 cell</th>
              <th style={th()}>PII</th>
              <th style={th()}>Geometry</th>
              <th style={th()}>Created</th>
              <th style={th()}></th>
            </tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td style={td()}>
                    <strong style={{ textTransform: 'capitalize' }}>{c.type.replace(/_/g, ' ')}</strong>
                    <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{c.id}</div>
                  </td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{c.h3_cell}</code></td>
                  <td style={td()}>
                    {c.pii_stripped
                      ? <Badge status="stripped" label="PII stripped" />
                      : <Badge status="pii" label="Has PII" />}
                  </td>
                  <td style={td()}><code style={{ fontSize: '0.72rem', color: '#6b7280' }}>{truncate(c.geometry)}</code></td>
                  <td style={td()}>{fmtDate(c.created_at)}</td>
                  <td style={td()}><button style={btn()} onClick={() => review(c)}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {open && (
        <Card title={`Review — ${open.type.replace(/_/g, ' ')}`} right={<button style={btn()} onClick={() => setOpen(null)}>Close</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <div><span style={{ color: '#6b7280' }}>Candidate ID:</span> <code>{open.id}</code></div>
            <div><span style={{ color: '#6b7280' }}>H3 cell:</span> <code>{open.h3_cell}</code></div>
            <div><span style={{ color: '#6b7280' }}>Type:</span> {open.type}</div>
            <div><span style={{ color: '#6b7280' }}>PII:</span> {open.pii_stripped ? <Badge status="stripped" label="PII stripped" /> : <Badge status="pii" label="Has PII" />}</div>
            <div><span style={{ color: '#6b7280' }}>Created:</span> {fmtDate(open.created_at)}</div>
          </div>

          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Geometry (GeoJSON)</h3>
          <pre style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '0.375rem', padding: '0.6rem', fontSize: '0.72rem', overflowX: 'auto', margin: '0 0 1rem' }}>{open.geometry}</pre>

          {!open.pii_stripped && (
            <p style={{ color: '#b91c1c', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
              This candidate is not marked PII-stripped — it must not be uploaded to OSM. Reject it.
            </p>
          )}

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={label()} htmlFor="notes">Review notes (optional)</label>
            <textarea id="notes" style={{ ...input(), minHeight: 70, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reviewer notes — recorded on the decision." />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              disabled={busy || !open.pii_stripped}
              style={{ ...btnPrimary(), opacity: busy || !open.pii_stripped ? 0.5 : 1, cursor: busy || !open.pii_stripped ? 'not-allowed' : 'pointer' }}
              onClick={() => decide('approve')}
            >
              Approve &amp; upload to OSM
            </button>
            <button disabled={busy} style={btnDanger()} onClick={() => decide('reject')}>Reject</button>
          </div>
        </Card>
      )}
    </div>
  );
}
