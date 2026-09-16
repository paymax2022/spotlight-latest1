'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import {
  listContestCategories, createContestCategory, updateContestCategory, deleteContestCategory,
  type ContestCategoryRow,
} from '@/services/contestCategoriesService';

// Competition categories, managed rather than hardcoded. Until this page there
// was no way to add one: the list lived as a const in three files at once —
// the ContestCategory union, `allowedCategories` in both admin contest routes
// (the gate that 400s "Invalid contest category"), and the create page's own
// CATEGORIES array. contests.category is plain TEXT with no CHECK constraint,
// so the database never restricted anything; those consts were the whole limit.
//
// Deactivate rather than delete is the primary action: it stops new contests
// using a category while leaving the ones already filed under it untouched and
// editable. Delete is offered only when nothing uses the category, and the
// server refuses it otherwise.

function slugPreview(raw: string): string {
  return raw
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export default function CompetitionCategoriesPage() {
  const [rows, setRows] = useState<ContestCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listContestCategories());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onCreate = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setBusy('create');
    setError(null);
    setNotice(null);
    try {
      // Sort to the end so a new category does not jump the established order.
      const nextSort = rows.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 10;
      const created = await createContestCategory({
        label,
        description: newDescription.trim() || null,
        sortOrder: nextSort,
      });
      setNewLabel('');
      setNewDescription('');
      setNotice(`Created “${created.label}” (${created.slug}).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create category');
    } finally {
      setBusy(null);
    }
  };

  const onToggleActive = async (row: ContestCategoryRow) => {
    setBusy(row.slug);
    setError(null);
    setNotice(null);
    try {
      await updateContestCategory(row.slug, { active: !row.active });
      setNotice(`${row.label} is now ${row.active ? 'inactive' : 'active'}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update category');
    } finally {
      setBusy(null);
    }
  };

  const onSaveEdit = async (slug: string) => {
    const label = editLabel.trim();
    if (!label) return;
    setBusy(slug);
    setError(null);
    setNotice(null);
    try {
      await updateContestCategory(slug, { label, description: editDescription.trim() || null });
      setEditing(null);
      setNotice('Category updated.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update category');
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (row: ContestCategoryRow) => {
    // The server is the authority on whether this is safe — it counts contests
    // filed under the slug and refuses with a 409 explaining why. This confirm
    // only guards against a misclick.
    if (!window.confirm(`Delete “${row.label}” permanently? Deactivating is usually what you want.`)) return;
    setBusy(row.slug);
    setError(null);
    setNotice(null);
    try {
      await deleteContestCategory(row.slug);
      setNotice(`Deleted “${row.label}”.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete category');
    } finally {
      setBusy(null);
    }
  };

  const activeCount = rows.filter((r) => r.active).length;

  return (
    <Page>
      <PageHeader
        title="Competition categories"
        subtitle="The categories a competition can be filed under. Active ones appear when creating or editing a competition."
        actions={
          <Link href="/admin/competitions/create" style={{ textDecoration: 'none' }}>
            <Button variant="outline">Back to create</Button>
          </Link>
        }
      />

      {error && (
        <Card style={{ marginBottom: 16, borderColor: colors.danger }}>
          <div style={{ color: colors.danger, fontSize: 13 }}>{error}</div>
        </Card>
      )}
      {notice && (
        <Card style={{ marginBottom: 16, borderColor: colors.success }}>
          <div style={{ color: colors.success, fontSize: 13 }}>{notice}</div>
        </Card>
      )}

      <Card title="Add a category" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px' }}>
            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 6 }}>Label</label>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Poetry & Spoken Word"
            />
            {newLabel.trim() && (
              <div style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>
                Saved as <code>{slugPreview(newLabel) || '—'}</code> — this is what is stored on a competition and cannot be changed later.
              </div>
            )}
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <label style={{ display: 'block', fontSize: 12, color: colors.muted, marginBottom: 6 }}>
              Description <span style={{ opacity: 0.7 }}>(optional)</span>
            </label>
            <Input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Shown to admins only"
            />
          </div>
          <Button onClick={onCreate} disabled={!newLabel.trim() || busy === 'create'}>
            {busy === 'create' ? 'Adding…' : 'Add category'}
          </Button>
        </div>
      </Card>

      <Card title={loading ? 'Categories' : `Categories — ${rows.length} total, ${activeCount} active`}>
        {loading ? (
          <div style={{ padding: 16, color: colors.muted, fontSize: 13 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 16, color: colors.muted, fontSize: 13 }}>
            No categories yet. Competitions fall back to the original built-in list until you add one.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Label</th>
                  <th style={thCell}>Slug</th>
                  <th style={thCell}>Description</th>
                  <th style={thCell}>Status</th>
                  <th style={{ ...thCell, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isEditing = editing === row.slug;
                  const rowBusy = busy === row.slug;
                  return (
                    <tr key={row.slug} style={{ opacity: row.active ? 1 : 0.6 }}>
                      <td style={tdCell}>
                        {isEditing ? (
                          <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                        ) : (
                          row.label
                        )}
                      </td>
                      <td style={{ ...tdCell, fontFamily: 'monospace', fontSize: 12, color: colors.muted }}>
                        {row.slug}
                      </td>
                      <td style={tdCell}>
                        {isEditing ? (
                          <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                        ) : (
                          row.description || <span style={{ color: colors.muted }}>—</span>
                        )}
                      </td>
                      <td style={tdCell}>
                        <Badge text={row.active ? 'Active' : 'Inactive'} color={row.active ? colors.success : colors.muted} />
                      </td>
                      <td style={{ ...tdCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <>
                            <Button variant="primary" onClick={() => onSaveEdit(row.slug)} disabled={rowBusy || !editLabel.trim()}>
                              {rowBusy ? 'Saving…' : 'Save'}
                            </Button>{' '}
                            <Button variant="outline" onClick={() => setEditing(null)} disabled={rowBusy}>Cancel</Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setEditing(row.slug);
                                setEditLabel(row.label);
                                setEditDescription(row.description ?? '');
                              }}
                              disabled={rowBusy}
                            >
                              Rename
                            </Button>{' '}
                            <Button variant="secondary" onClick={() => onToggleActive(row)} disabled={rowBusy}>
                              {row.active ? 'Deactivate' : 'Activate'}
                            </Button>{' '}
                            <Button variant="danger" onClick={() => onDelete(row)} disabled={rowBusy}>
                              Delete
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ marginTop: 12, fontSize: 12, color: colors.muted, lineHeight: 1.6 }}>
        The slug is what gets stored on a competition, so it is fixed once created — renaming changes only the
        display label. Deactivating hides a category from new and edited competitions without affecting the ones
        already using it; deleting is refused while any competition is filed under it.
      </div>
    </Page>
  );
}
