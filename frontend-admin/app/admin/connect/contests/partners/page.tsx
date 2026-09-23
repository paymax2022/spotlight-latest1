'use client';

// Contest Partners admin — CRUD over contest_partners (organisations that run
// child contests, e.g. "Golibe" running a state-level round that feeds into a
// national contest). Go-backed: backend/internal/connect/voting/promotion_*.go,
// gated behind FEATURE_CONTEST_PROMOTION_ENABLED. Every list/create/update call
// 404s while the flag is off — surfaced as a plain notice, not a page error,
// since the page itself (and the RBAC-gated nav entry) is fine to exist ahead
// of the flag flip.

import { useCallback, useEffect, useState } from 'react';
import {
  listPartners, createPartner, updatePartner, ContestPromotionError,
  type ContestPartner,
} from '@/services/contestPromotionService';
import { PageHeader, Card, btn, th, td } from '../../_ui';
import { Page, colors, Button, Input } from '@/components/ui/vuexy';

type Draft = { name: string; contactEmail: string; contactPhone: string; logoUrl: string; notes: string };
const emptyDraft = (): Draft => ({ name: '', contactEmail: '', contactPhone: '', logoUrl: '', notes: '' });

export default function ContestPartnersPage() {
  const [rows, setRows] = useState<ContestPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flagOff, setFlagOff] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFlagOff(false);
    try {
      setRows(await listPartners());
    } catch (e) {
      if (e instanceof ContestPromotionError && e.status === 404) {
        setFlagOff(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    if (!draft.name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const p = await createPartner(draft);
      setRows((prev) => [p, ...prev]);
      setDraft(emptyDraft());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create partner');
    } finally {
      setCreating(false);
    }
  }, [draft]);

  function startEdit(p: ContestPartner) {
    setEditingId(p.id);
    setEditDraft({
      name: p.name,
      contactEmail: p.contact_email || '',
      contactPhone: p.contact_phone || '',
      logoUrl: p.logo_url || '',
      notes: p.notes || '',
    });
  }

  const saveEdit = useCallback(async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const p = await updatePartner(id, editDraft);
      setRows((prev) => prev.map((r) => (r.id === id ? p : r)));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update partner');
    } finally {
      setSaving(false);
    }
  }, [editDraft]);

  return (
    <Page>
      <PageHeader title="Contest Partner Organisations" subtitle="External orgs that run child contests — see the contest builder's 'Contest hierarchy' panel to link a contest to a partner." action={<button onClick={load} style={btn()}>Refresh</button>} />

      {flagOff && (
        <Card>
          <p style={{ color: colors.warning, margin: 0, fontSize: 13 }}>
            Contest promotion is not enabled on this backend (FEATURE_CONTEST_PROMOTION_ENABLED is off) — every call here 404s until an operator flips it.
          </p>
        </Card>
      )}
      {error && <Card><p style={{ color: colors.danger, margin: 0 }}>{error}</p></Card>}

      <Card title="Add a partner">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <Input placeholder="Name *" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <Input placeholder="Contact email" value={draft.contactEmail} onChange={(e) => setDraft((d) => ({ ...d, contactEmail: e.target.value }))} />
          <Input placeholder="Contact phone" value={draft.contactPhone} onChange={(e) => setDraft((d) => ({ ...d, contactPhone: e.target.value }))} />
          <Input placeholder="Logo URL" value={draft.logoUrl} onChange={(e) => setDraft((d) => ({ ...d, logoUrl: e.target.value }))} />
        </div>
        <Input placeholder="Notes" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} style={{ width: '100%', marginBottom: 10 }} />
        <Button variant="primary" disabled={creating || !draft.name.trim()} onClick={() => void create()}>
          {creating ? 'Adding…' : '+ Add partner'}
        </Button>
      </Card>

      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No partner organisations yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Name', 'Contact', 'Notes', ''].map((h) => <th key={h} style={th()}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  {editingId === p.id ? (
                    <>
                      <td style={td()}><Input value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} /></td>
                      <td style={td()}>
                        <Input placeholder="email" value={editDraft.contactEmail} onChange={(e) => setEditDraft((d) => ({ ...d, contactEmail: e.target.value }))} style={{ marginBottom: 4 }} />
                        <Input placeholder="phone" value={editDraft.contactPhone} onChange={(e) => setEditDraft((d) => ({ ...d, contactPhone: e.target.value }))} />
                      </td>
                      <td style={td()}><Input value={editDraft.notes} onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))} /></td>
                      <td style={{ ...td(), textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Button sm variant="primary" disabled={saving} onClick={() => void saveEdit(p.id)}>{saving ? 'Saving…' : 'Save'}</Button>{' '}
                        <Button sm onClick={() => setEditingId(null)}>Cancel</Button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={td()}><strong>{p.name}</strong></td>
                      <td style={td()}>{p.contact_email || '—'}{p.contact_phone ? ` · ${p.contact_phone}` : ''}</td>
                      <td style={td()}>{p.notes || '—'}</td>
                      <td style={{ ...td(), textAlign: 'right' }}>
                        <Button sm onClick={() => startEdit(p)}>Edit</Button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
