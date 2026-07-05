'use client';

import { useRef, useState } from 'react';
import {
  previewImport, confirmImport, bulkImportMembers,
  type ImportPreviewResult,
} from '@/services/associationAdminService';
import {
  PageHeader, AssociationTabs, Card, DisclosureNote, AuditNote,
  btn, btnPrimary, th, td, input, label as lbl,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../_ui';

export default function AssociationImportPage() {
  const { can } = useAssociationPermissions();
  const canManage = can(ASSOCIATION_PERMS.manage);

  const fileRef = useRef<HTMLInputElement>(null);
  const [orgId, setOrgId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [sendInvites, setSendInvites] = useState(true);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function doPreview() {
    if (!file) { setError('Choose a CSV file first.'); return; }
    if (!orgId.trim()) { setError('Organisation ID is required.'); return; }
    setLoading(true); setError(null); setMsg(null); setPreview(null);
    try { setPreview(await previewImport(orgId.trim(), file)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  async function doConfirm() {
    if (!preview) return;
    if (preview.valid === 0) { setError('No valid rows to import.'); return; }
    setConfirming(true); setError(null); setMsg(null);
    try {
      const res = await confirmImport(sendInvites);
      setMsg(`Imported ${res.imported} member(s), skipped ${res.skipped}, invited ${res.invited}. Batch ${res.batchId}. Recorded to audit log (NL-12).`);
      setPreview(null); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) { setError(String(e)); }
    finally { setConfirming(false); }
  }

  // Alternate one-shot path some org admins prefer: skip the preview/confirm
  // two-step and post the CSV straight to /admin/import/members. Kept as a
  // secondary action since the preview flow is the safer default (lets the
  // admin see duplicates/invalid rows before anything persists).
  async function doBulkImportDirect() {
    if (!file) { setError('Choose a CSV file first.'); return; }
    if (!orgId.trim()) { setError('Organisation ID is required.'); return; }
    setConfirming(true); setError(null); setMsg(null);
    try {
      const res = await bulkImportMembers(orgId.trim(), file);
      setMsg(`Direct import complete — ${res.imported} member(s) imported. Recorded to audit log (NL-12).`);
      setFile(null); setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) { setError(String(e)); }
    finally { setConfirming(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Bulk member import"
        subtitle="Upload a CSV of members, review the preview (valid / duplicate / invalid rows), then confirm to persist and optionally send invites."
        action={undefined}
      />
      <AssociationTabs active="import" />
      <DisclosureNote>
        Preview via <code>POST /api/finance/associations/admin/import/preview</code>, confirm via{' '}
        <code>POST /api/finance/associations/admin/import/confirm</code>. Nothing persists until you confirm.
        Every confirmed import batch is recorded to the immutable audit log (NL-12).
      </DisclosureNote>

      {!canManage && <PermissionBanner text="You have read-only access — your role cannot run member imports." />}
      {msg && <AuditNote>{msg}</AuditNote>}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card title="1. Upload CSV">
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 220 }}>
            <label style={lbl()}>Organisation ID</label>
            <input style={input()} value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="org uuid" disabled={!canManage} />
          </div>
          <div>
            <label style={lbl()}>CSV file</label>
            <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={!canManage} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <button style={btn()} disabled={!canManage || loading || !file} onClick={() => void doPreview()}>{loading ? 'Loading preview…' : 'Preview'}</button>
          <button style={btn()} disabled={!canManage || confirming || !file} onClick={() => void doBulkImportDirect()} title="Skips the preview step and imports immediately">
            {confirming && !preview ? 'Importing…' : 'Import directly (skip preview)'}
          </button>
        </div>
      </Card>

      {preview && (
        <Card title={`2. Preview — ${preview.fileName}`}>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
            <span>Total: <strong>{preview.total}</strong></span>
            <span style={{ color: '#15803d' }}>Valid: <strong>{preview.valid}</strong></span>
            <span style={{ color: '#9a3412' }}>Duplicates: <strong>{preview.duplicates}</strong></span>
            <span style={{ color: '#b91c1c' }}>Invalid: <strong>{preview.invalid}</strong></span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.75rem' }}>
            <thead><tr>
              <th style={th()}>Row</th><th style={th()}>Name</th><th style={th()}>Phone</th>
              <th style={th()}>Email</th><th style={th()}>Chapter</th><th style={th()}>Issue</th>
            </tr></thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.rowNum} style={r.issue ? { background: '#fef2f2' } : undefined}>
                  <td style={td()}>{r.rowNum}</td>
                  <td style={td()}>{r.name}</td>
                  <td style={td()}>{r.phone}</td>
                  <td style={td()}>{r.email}</td>
                  <td style={td()}>{r.chapter}</td>
                  <td style={td()}>{r.issue ? <span style={{ color: '#b91c1c' }}>{r.issue}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            <input type="checkbox" checked={sendInvites} onChange={(e) => setSendInvites(e.target.checked)} disabled={!canManage} />
            Send invitation to each imported member
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button style={btnPrimary()} disabled={!canManage || confirming || preview.valid === 0} onClick={() => void doConfirm()}>
              {confirming ? 'Confirming…' : `Confirm import (${preview.valid} row${preview.valid === 1 ? '' : 's'})`}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
