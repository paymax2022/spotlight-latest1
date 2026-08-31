'use client';

// Document vault authoring.
//
// The file itself is NOT uploaded here. The backend stores only a storage key
// (assoc_documents.storage_key) and there is no upload route in the association
// module — so this page registers the vault entry against a key produced by
// whatever uploaded the object, and says so rather than implying a file picker
// that does not exist.

import { useState } from 'react';
import {
  listAdminDocuments, createDocument, updateDocument, deleteDocument,
  DOCUMENT_KINDS,
  type DocumentRow, type DocumentInput, type DocumentKind,
} from '@/services/associationAdminService';
import { useSelectedOrg, fmtDate } from '../../_ui';
import {
  ContentScaffold, StateBlock, useContentRows, Field, Check, NotifyCheck, MetaLine,
  useAssociationPermissions, ASSOCIATION_PERMS,
  formGrid, selectStyle, textareaStyle,
} from '../_content';
import { Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

// assoc_documents.category is free text; these are the buckets the member app
// groups by. Anything else lands in an "other" pile nobody browses.
const CATEGORIES = ['GOVERNANCE', 'FINANCE', 'MINUTES', 'FORMS', 'POLICY', 'OTHER'];

type Draft = {
  title: string; category: string; kind: DocumentKind; storageKey: string;
  sizeLabel: string; version: string; restricted: boolean; requiresAck: boolean;
  aiSummary: string; notify: boolean;
};
const EMPTY: Draft = {
  title: '', category: 'GOVERNANCE', kind: 'pdf', storageKey: '',
  sizeLabel: '', version: 'v1', restricted: false, requiresAck: false,
  aiSummary: '', notify: false,
};

export default function AssociationDocumentsPage() {
  const orgId = useSelectedOrg();
  const { can } = useAssociationPermissions();
  const canManage = can(ASSOCIATION_PERMS.manage);

  const { rows, loading, error, reload, setError } = useContentRows<DocumentRow>(
    orgId, (id) => listAdminDocuments(id, { limit: 100 }),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  function beginAdd() { setEditingId('new'); setDraft(EMPTY); setMsg(null); setError(null); }
  function beginEdit(r: DocumentRow) {
    setEditingId(r.id); setMsg(null); setError(null);
    setDraft({
      title: r.title,
      // The listing puts category in `subtitle` (SELECT d.category) — meta has no copy of it.
      category: r.subtitle || 'OTHER',
      kind: (DOCUMENT_KINDS.includes(r.meta.kind as DocumentKind) ? r.meta.kind : 'pdf') as DocumentKind,
      storageKey: r.meta.storageKey ?? '',
      sizeLabel: r.meta.sizeLabel ?? '',
      version: r.meta.version || 'v1',
      restricted: !!r.meta.restricted,
      requiresAck: !!r.meta.requiresAck,
      aiSummary: r.meta.aiSummary ?? '',
      notify: false,
    });
  }

  async function save() {
    if (!orgId) return;
    const isNew = editingId === 'new';
    setBusy(true); setError(null); setMsg(null);
    try {
      const title = draft.title.trim();
      if (!title) throw new Error('A title is required.');
      const category = draft.category.trim();
      if (!category) throw new Error('A category is required.');
      const input: DocumentInput = {
        title, category, kind: draft.kind,
        storageKey: draft.storageKey.trim() || null,
        sizeLabel: draft.sizeLabel.trim() || null,
        version: draft.version.trim() || 'v1',
        restricted: draft.restricted,
        requiresAck: draft.requiresAck,
        aiSummary: draft.aiSummary.trim() || null,
        ...(isNew ? { notify: draft.notify } : {}),
      };
      if (isNew) await createDocument(orgId, input);
      else await updateDocument(editingId!, input);
      setMsg(
        `${isNew ? 'Added' : 'Updated'} "${title}".`
        + (isNew && draft.notify ? ' Every active member was notified in-app.' : '')
        + ' Recorded to the audit log (NL-12).',
      );
      setEditingId(null); setDraft(EMPTY);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove(r: DocumentRow) {
    if (!window.confirm(`Delete "${r.title}" from the vault? Member acknowledgements of it go too. This cannot be undone.`)) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      await deleteDocument(r.id);
      setMsg(`Deleted "${r.title}". Recorded to the audit log (NL-12).`);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const editing = editingId !== null;

  return (
    <ContentScaffold
      tab="documents"
      title="Documents"
      subtitle="The organisation's document vault — constitution, minutes, policies and forms, with per-document restriction and acknowledgement."
      disclosure={<>
        Writes go to <code>/api/finance/associations/admin/organisations/:id/documents</code>. This registers the vault
        entry only — <strong>the file is uploaded elsewhere</strong> and referenced here by its storage key; the
        association module has no upload route. <em>Restricted</em> limits the document to authorised members;{' '}
        <em>requires acknowledgement</em> asks each member to confirm they have read it. Recorded to the immutable
        audit log (NL-12).
      </>}
      orgId={orgId} loading={loading} error={error} msg={msg} canManage={canManage} onRefresh={() => void reload()}
    >
      <Card title={editing ? (editingId === 'new' ? 'New document' : 'Edit document') : 'Vault'}>
        {!canManage ? <p style={{ fontSize: '0.85rem', color: colors.muted, marginTop: 12 }}>Read-only.</p> : !editing ? (
          <div style={{ marginTop: 12 }}><Button variant="primary" onClick={beginAdd}>Add document</Button></div>
        ) : (
          <>
            <div style={formGrid}>
              <Field label="Title" wide>
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Constitution (2026 revision)" />
              </Field>
              {/* Free text on the backend, so this suggests the buckets the
                  member app groups by without refusing an existing value that
                  predates the list. */}
              <Field label="Category">
                <Input list="assoc-doc-categories" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="e.g. GOVERNANCE" />
                <datalist id="assoc-doc-categories">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field label="Kind">
                <select style={selectStyle} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as DocumentKind })}>
                  {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </Field>
              <Field label="Version">
                <Input value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} placeholder="v1" />
              </Field>
              <Field label="Size label (display only)">
                <Input value={draft.sizeLabel} onChange={(e) => setDraft({ ...draft, sizeLabel: e.target.value })} placeholder="e.g. 1.2 MB" />
              </Field>
              <Field label="Storage key (object key of the uploaded file)" wide>
                <Input value={draft.storageKey} onChange={(e) => setDraft({ ...draft, storageKey: e.target.value })} placeholder="e.g. assoc/constitution-2026.pdf" />
              </Field>
              <Field label="Summary shown to members (optional)" wide>
                <textarea style={{ ...textareaStyle, minHeight: 72 }} value={draft.aiSummary} onChange={(e) => setDraft({ ...draft, aiSummary: e.target.value })} />
              </Field>
              <div style={{ display: 'grid', gap: 8, alignContent: 'end' }}>
                <Check label="Restricted" checked={draft.restricted} onChange={(v) => setDraft({ ...draft, restricted: v })} />
                <Check label="Requires acknowledgement" checked={draft.requiresAck} onChange={(v) => setDraft({ ...draft, requiresAck: v })} />
              </div>
              {editingId === 'new' && (
                <NotifyCheck what="document" checked={draft.notify} onChange={(v) => setDraft({ ...draft, notify: v })} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : editingId === 'new' ? 'Add to vault' : 'Save changes'}</Button>
              <Button variant="outline" disabled={busy} onClick={() => { setEditingId(null); setDraft(EMPTY); }}>Cancel</Button>
            </div>
          </>
        )}
      </Card>

      <Card title={`Vault (${rows.length})`}>
        <StateBlock loading={loading} error={null} empty={rows.length === 0} emptyText="No documents in this organisation's vault yet.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Document</th><th style={thCell}>Category</th><th style={thCell}>Kind</th>
              <th style={thCell}>Version</th><th style={thCell}>Access</th><th style={thCell}>Acknowledged</th>
              <th style={thCell}>Updated</th><th style={thCell}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}>
                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                    <MetaLine parts={[r.meta.storageKey, r.meta.sizeLabel, r.meta.uploadedBy]} />
                  </td>
                  <td style={tdCell}>{r.subtitle || '—'}</td>
                  <td style={tdCell}>{r.meta.kind}</td>
                  <td style={tdCell}>{r.meta.version || '—'}</td>
                  <td style={tdCell}>
                    <Badge text={r.meta.restricted ? 'Restricted' : 'Open'} color={r.meta.restricted ? colors.warning : colors.success} />
                  </td>
                  <td style={tdCell}>{r.meta.requiresAck ? (r.meta.ackCount ?? 0).toLocaleString('en-NG') : '—'}</td>
                  <td style={tdCell}>{fmtDate(r.at)}</td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button sm variant="outline" disabled={!canManage || busy} onClick={() => beginEdit(r)}>Edit</Button>
                      <Button sm variant="danger" disabled={!canManage || busy} onClick={() => void remove(r)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </ContentScaffold>
  );
}
