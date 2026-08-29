'use client';

import { useRef, useState } from 'react';
import {
  previewImport, confirmImport, bulkImportMembers,
  type ImportPreviewResult,
} from '@/services/associationAdminService';
import {
  AssociationTabs, DisclosureNote, AuditNote, OrgPicker, useSelectedOrg,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, tint, thCell, tdCell } from '@/components/ui/vuexy';

export default function AssociationImportPage() {
  const { can } = useAssociationPermissions();
  const canManage = can(ASSOCIATION_PERMS.manage);
  const orgId = useSelectedOrg();

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [sendInvites, setSendInvites] = useState(true);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function doPreview() {
    if (!file) { setError('Choose a CSV file first.'); return; }
    if (!orgId) { setError('Select an organisation above first.'); return; }
    setLoading(true); setError(null); setMsg(null); setPreview(null);
    try { setPreview(await previewImport(orgId, file)); }
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
    if (!orgId) { setError('Select an organisation above first.'); return; }
    setConfirming(true); setError(null); setMsg(null);
    try {
      const res = await bulkImportMembers(orgId, file);
      setMsg(`Direct import complete — ${res.imported} member(s) imported. Recorded to audit log (NL-12).`);
      setFile(null); setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) { setError(String(e)); }
    finally { setConfirming(false); }
  }

  return (
    <Page>
      <PageHeader
        title="Bulk member import"
        subtitle="Upload a CSV of members, review the preview (valid / duplicate / invalid rows), then confirm to persist and optionally send invites."
      />
      <AssociationTabs active="import" />
      <OrgPicker />
      <DisclosureNote>
        Preview via <code>POST /api/finance/associations/admin/import/preview</code>, confirm via{' '}
        <code>POST /api/finance/associations/admin/import/confirm</code>. Nothing persists until you confirm.
        Every confirmed import batch is recorded to the immutable audit log (NL-12).
      </DisclosureNote>

      {!canManage && <PermissionBanner text="You have read-only access — your role cannot run member imports." />}
      {msg && <AuditNote>{msg}</AuditNote>}
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card title="1. Upload CSV">
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>CSV file</label>
            <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={!canManage} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <Button variant="outline" disabled={!canManage || loading || !file} onClick={() => void doPreview()}>{loading ? 'Loading preview…' : 'Preview'}</Button>
          <Button variant="outline" disabled={!canManage || confirming || !file} onClick={() => void doBulkImportDirect()} title="Skips the preview step and imports immediately">
            {confirming && !preview ? 'Importing…' : 'Import directly (skip preview)'}
          </Button>
        </div>
      </Card>

      {preview && (
        <Card title={`2. Preview — ${preview.fileName}`}>
          <div style={{ display: 'flex', gap: '1.5rem', marginTop: 12, marginBottom: '0.75rem', fontSize: '0.85rem' }}>
            <span>Total: <strong>{preview.total}</strong></span>
            <span style={{ color: colors.success }}>Valid: <strong>{preview.valid}</strong></span>
            <span style={{ color: colors.warning }}>Duplicates: <strong>{preview.duplicates}</strong></span>
            <span style={{ color: colors.danger }}>Invalid: <strong>{preview.invalid}</strong></span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.75rem' }}>
            <thead><tr>
              <th style={thCell}>Row</th><th style={thCell}>Name</th><th style={thCell}>Phone</th>
              <th style={thCell}>Email</th><th style={thCell}>Chapter</th><th style={thCell}>Issue</th>
            </tr></thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.rowNum} style={r.issue ? { background: tint(colors.danger, 0.06) } : undefined}>
                  <td style={tdCell}>{r.rowNum}</td>
                  <td style={tdCell}>{r.name}</td>
                  <td style={tdCell}>{r.phone}</td>
                  <td style={tdCell}>{r.email}</td>
                  <td style={tdCell}>{r.chapter}</td>
                  <td style={tdCell}>{r.issue ? <span style={{ color: colors.danger }}>{r.issue}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            <input type="checkbox" checked={sendInvites} onChange={(e) => setSendInvites(e.target.checked)} disabled={!canManage} />
            Send invitation to each imported member
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" disabled={!canManage || confirming || preview.valid === 0} onClick={() => void doConfirm()}>
              {confirming ? 'Confirming…' : `Confirm import (${preview.valid} row${preview.valid === 1 ? '' : 's'})`}
            </Button>
          </div>
        </Card>
      )}
    </Page>
  );
}
