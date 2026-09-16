'use client';

// Per-association custom settings.
//
// `settings` is a free-form jsonb object on assoc_organisations with no schema —
// so the editor cannot be a fixed form. It is a key/value row editor with an
// explicit type per row, plus a raw-JSON escape hatch for nested structures.
//
// The PUT is a MERGE, not a replace: the body is a partial object, and a `null`
// value DELETES that key. That is what makes deletion expressible at all, and it
// means a key this page never saw is never clobbered by a save.

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import {
  getAdminOrganisation, getOrganisationSettings, updateOrganisationSettings,
  type AdminOrganisationDetail,
} from '@/services/associationAdminService';
import {
  DisclosureNote, AuditNote, StateBlock,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

type ValueKind = 'string' | 'number' | 'boolean' | 'json';
interface Row { id: number; key: string; kind: ValueKind; value: string; originalKey: string | null }

const selectStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
  fontSize: '0.85rem', background: colors.card, cursor: 'pointer',
};
const textareaStyle: React.CSSProperties = {
  padding: '0.45rem 0.55rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem',
  fontSize: '0.82rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', width: '100%', boxSizing: 'border-box',
};

function kindOf(v: unknown): ValueKind {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return 'string';
  return 'json';
}
function toText(v: unknown, kind: ValueKind): string {
  if (kind === 'string') return String(v ?? '');
  if (kind === 'boolean') return v ? 'true' : 'false';
  if (kind === 'number') return String(v ?? 0);
  return JSON.stringify(v ?? null, null, 2);
}
/** Parse one row back to the JSON value that goes on the wire. Throws with a per-row message. */
function toValue(row: Row): unknown {
  if (row.kind === 'string') return row.value;
  if (row.kind === 'boolean') return row.value === 'true';
  if (row.kind === 'number') {
    const n = Number(row.value.trim());
    if (!Number.isFinite(n)) throw new Error(`"${row.key}": "${row.value}" is not a number`);
    return n;
  }
  try { return JSON.parse(row.value); }
  catch (e) { throw new Error(`"${row.key}": invalid JSON — ${e instanceof Error ? e.message : String(e)}`); }
}
function rowsFrom(settings: Record<string, unknown>): Row[] {
  return Object.entries(settings).map(([k, v], i) => {
    const kind = kindOf(v);
    return { id: i, key: k, kind, value: toText(v, kind), originalKey: k };
  });
}

export default function AssociationOrganisationSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAssociationPermissions();
  const canManage = can(ASSOCIATION_PERMS.manage);

  const [org, setOrg] = useState<AdminOrganisationDetail | null>(null);
  const [saved, setSaved] = useState<Record<string, unknown>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [seq, setSeq] = useState(1000);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [rawText, setRawText] = useState('{}');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [detail, settings] = await Promise.all([getAdminOrganisation(id), getOrganisationSettings(id)]);
      const obj = settings ?? {};
      setOrg(detail); setSaved(obj); setRows(rowsFrom(obj)); setRawText(JSON.stringify(obj, null, 2));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  function patchRow(rowId: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { id: seq, key: '', kind: 'string', value: '', originalKey: null }]);
    setSeq((s) => s + 1);
  }
  /** Drop the row locally. The key only actually goes away on save, as an explicit null. */
  function dropRow(rowId: number) { setRows((rs) => rs.filter((r) => r.id !== rowId)); }

  async function save() {
    setBusy(true); setError(null); setMsg(null);
    try {
      let patch: Record<string, unknown>;
      if (raw) {
        let parsed: unknown;
        try { parsed = JSON.parse(rawText); }
        catch (e) { throw new Error(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`); }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Settings must be a JSON object, e.g. { "key": "value" }');
        patch = { ...(parsed as Record<string, unknown>) };
        // Raw mode edits the WHOLE object, so a key the operator deleted from
        // the text must become an explicit null — the endpoint merges, and a
        // merge can never remove a key by omission.
        for (const k of Object.keys(saved)) if (!(k in patch)) patch[k] = null;
      } else {
        patch = {};
        const seen = new Set<string>();
        for (const r of rows) {
          const key = r.key.trim();
          if (!key) throw new Error('Every setting needs a key');
          if (seen.has(key)) throw new Error(`Duplicate key "${key}"`);
          seen.add(key);
          patch[key] = toValue(r);
          // A renamed key is an add + a delete: the old name is nulled below.
        }
        for (const k of Object.keys(saved)) if (!seen.has(k)) patch[k] = null;
      }

      const deletes = Object.entries(patch).filter(([, v]) => v === null).map(([k]) => k);
      if (deletes.length && !window.confirm(`This will DELETE ${deletes.length} setting(s): ${deletes.join(', ')}. Continue?`)) { setBusy(false); return; }

      const merged = await updateOrganisationSettings(id, patch);
      const obj = merged ?? {};
      setSaved(obj); setRows(rowsFrom(obj)); setRawText(JSON.stringify(obj, null, 2));
      setMsg(`Saved. ${Object.keys(patch).length - deletes.length} key(s) written${deletes.length ? `, ${deletes.length} deleted` : ''}. Recorded to the audit log (NL-12).`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <p>
        <Link href={`/admin/association/organisations/${id}`} style={{ color: colors.primary }}>← Back to organisation</Link>
        {' · '}
        <Link href="/admin/association/organisations" style={{ color: colors.primary }}>All organisations</Link>
      </p>
      <PageHeader
        title={org ? `${org.name} — custom settings` : 'Custom settings'}
        subtitle="Free-form per-association configuration. There is no schema: keys and value types are whatever this association needs."
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" onClick={() => { setRaw(!raw); setError(null); if (!raw) setRawText(JSON.stringify(saved, null, 2)); else setRows(rowsFrom(saved)); }}>{raw ? 'Key/value editor' : 'Raw JSON'}</Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading || busy}>{loading ? 'Loading…' : 'Reload'}</Button>
          </div>
        )}
      />

      <DisclosureNote>
        Backed by <code>GET|PUT /api/finance/associations/admin/organisations/:id/settings</code>. The PUT <strong>merges</strong>:
        keys you do not send are left alone, and a key sent as <code>null</code> is <strong>deleted</strong>. Removing a row here
        sends that null on save. Every write is recorded to the immutable audit log (NL-12).
      </DisclosureNote>
      {msg && <AuditNote>{msg}</AuditNote>}
      {error && <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{error}</p>}
      {!canManage && <PermissionBanner text="You have read-only access — your role can view these settings but cannot change them." />}

      <Card title={`Settings (${rows.length})`}>
        <StateBlock loading={loading} error={null} empty={false}>
          {raw ? (
            <>
              <textarea rows={16} style={textareaStyle} disabled={!canManage} value={rawText} onChange={(e) => setRawText(e.target.value)} spellCheck={false} />
              <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: 6 }}>
                Must be a JSON object. Any key you remove from this text is deleted on save (sent as <code>null</code>).
                Parse errors are reported above the editor, not swallowed.
              </p>
            </>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thCell}>Key</th><th style={thCell}>Type</th><th style={thCell}>Value</th><th style={thCell}></th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td style={tdCell} colSpan={4}>No custom settings for this association yet.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...tdCell, width: '26%' }}>
                      <Input value={r.key} disabled={!canManage} onChange={(e) => patchRow(r.id, { key: e.target.value })} placeholder="e.g. welcomeMessage" />
                      {r.originalKey === null && <Badge text="new" color={colors.info} />}
                    </td>
                    <td style={{ ...tdCell, width: 130 }}>
                      <select style={selectStyle} disabled={!canManage} value={r.kind}
                        onChange={(e) => {
                          const kind = e.target.value as ValueKind;
                          // Re-render the current text in the new type's shape so
                          // switching type never leaves an unparseable value behind.
                          let v = r.value;
                          if (kind === 'boolean') v = r.value === 'true' ? 'true' : 'false';
                          else if (kind === 'number') v = Number.isFinite(Number(r.value)) ? r.value : '0';
                          else if (kind === 'json') { try { JSON.parse(r.value); } catch { v = JSON.stringify(r.value); } }
                          patchRow(r.id, { kind, value: v });
                        }}>
                        <option value="string">string</option><option value="number">number</option>
                        <option value="boolean">boolean</option><option value="json">JSON</option>
                      </select>
                    </td>
                    <td style={tdCell}>
                      {r.kind === 'boolean' ? (
                        <select style={selectStyle} disabled={!canManage} value={r.value} onChange={(e) => patchRow(r.id, { value: e.target.value })}>
                          <option value="true">true</option><option value="false">false</option>
                        </select>
                      ) : r.kind === 'json' ? (
                        <textarea rows={3} style={textareaStyle} disabled={!canManage} value={r.value} onChange={(e) => patchRow(r.id, { value: e.target.value })} spellCheck={false} />
                      ) : (
                        <Input value={r.value} disabled={!canManage} onChange={(e) => patchRow(r.id, { value: e.target.value })} />
                      )}
                    </td>
                    <td style={{ ...tdCell, width: 80 }}>
                      {canManage && (
                        <button type="button" onClick={() => dropRow(r.id)} disabled={busy}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.8rem', color: colors.danger }}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </StateBlock>

        {canManage && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {!raw && <Button variant="outline" disabled={busy} onClick={addRow}>+ Add setting</Button>}
            <Button variant="primary" disabled={busy || loading} onClick={() => void save()}>{busy ? 'Saving…' : 'Save settings'}</Button>
            <Button variant="outline" disabled={busy} onClick={() => { setRows(rowsFrom(saved)); setRawText(JSON.stringify(saved, null, 2)); setError(null); setMsg(null); }}>Discard changes</Button>
          </div>
        )}
      </Card>
    </Page>
  );
}
