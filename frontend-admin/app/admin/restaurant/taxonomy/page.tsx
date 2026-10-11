'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  listCategories,
  createCategory,
  setCategoryActive,
  deleteCategory,
  seedDefaults,
  listCuisines,
  createCuisine,
  setCuisineActive,
  TaxonomyError,
  type TaxonomyKind,
  type TaxonomyNode,
  type Cuisine,
} from '@/services/restaurantTaxonomyService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const KINDS: TaxonomyKind[] = ['FOOD', 'DRINK', 'OTHER'];

function describe(e: unknown): string {
  if (e instanceof TaxonomyError) {
    if (e.status === 404) return 'The menu taxonomy is not enabled on this server (FEATURE_RESTAURANT_ADMIN_CATEGORIES).';
    if (e.status === 403) return 'Your account cannot manage the menu taxonomy.';
    if (e.code === 'name_or_slug_taken') return 'That name is already used here. Pick a different name.';
    if (e.code === 'in_use') return e.message;
    if (e.code === 'default_row_deactivate_instead') return 'Default rows cannot be deleted. Deactivate them instead.';
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export default function RestaurantTaxonomyPage() {
  const [tree, setTree] = useState<TaxonomyNode[]>([]);
  const [cuisines, setCuisines] = useState<Cuisine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TaxonomyKind>('FOOD');
  const [parentId, setParentId] = useState('');
  const [cuisineName, setCuisineName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, c] = await Promise.all([listCategories(), listCuisines()]);
      setTree(t);
      setCuisines(c);
    } catch (e) {
      setError(describe(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(label);
      await load();
    } catch (e) {
      setError(describe(e));
    }
  };

  const onAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await run(`Added "${name.trim()}".`, async () => {
      await createCategory({ name: name.trim(), kind, parent_id: parentId || null });
      setName('');
      setParentId('');
    });
  };

  const onAddCuisine = async (e: FormEvent) => {
    e.preventDefault();
    if (!cuisineName.trim()) return;
    await run(`Added cuisine "${cuisineName.trim()}".`, async () => {
      await createCuisine(cuisineName.trim());
      setCuisineName('');
    });
  };

  const topLevel = tree.filter((n) => n.parent_id === null);

  return (
    <Page>
      <PageHeader
        title="Menu taxonomy"
        subtitle="The categories and cuisines owners pick from. Owners cannot create or delete categories; only admins manage them here."
      />

      {error ? <p role="alert" style={{ color: colors.danger, marginBottom: 12 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, marginBottom: 12 }}>{notice}</p> : null}

      <Card
        title="Categories"
        right={<Button variant="outline" sm onClick={() => run('Default categories re-synced.', async () => { const r = await seedDefaults(); setNotice(`Re-synced defaults: ${r.inserted} added, ${r.skipped} already present.`); })}>Re-sync defaults</Button>}
      >
        <form onSubmit={onAddCategory} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <Input placeholder="Category or sub-category name" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 240 }} />
          <select value={kind} onChange={(e) => setKind(e.target.value as TaxonomyKind)} aria-label="Kind" style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13 }}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} aria-label="Parent" style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.inputBorder}`, fontSize: 13, minWidth: 200 }}>
            <option value="">Top-level category</option>
            {topLevel.map((n) => <option key={n.id} value={n.id}>Sub-category of {n.name}</option>)}
          </select>
          <Button type="submit" sm>Add</Button>
        </form>

        {loading && tree.length === 0 ? <p style={{ color: colors.muted }}>Loading…</p> : null}

        {tree.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Name', 'Kind', 'Items', 'Status', ''].map((h) => <th key={h} style={thCell}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {topLevel.flatMap((parent) => [parent, ...parent.children]).map((n) => {
                  const isSub = n.parent_id !== null;
                  return (
                    <tr key={n.id} style={{ opacity: n.is_active ? 1 : 0.55 }}>
                      <td style={{ ...tdCell, paddingLeft: isSub ? 28 : undefined, fontWeight: isSub ? 400 : 600 }}>
                        {n.name}{n.is_system_seeded ? <span style={{ marginLeft: 6, fontSize: 11, color: colors.muted }}>default</span> : null}
                      </td>
                      <td style={tdCell}>{n.kind}</td>
                      <td style={tdCell}>{n.item_count}</td>
                      <td style={tdCell}><Badge text={n.is_active ? 'active' : 'inactive'} color={n.is_active ? colors.success : colors.muted} /></td>
                      <td style={{ ...tdCell, whiteSpace: 'nowrap' }}>
                        <Button variant="outline" sm onClick={() => run(`${n.name} ${n.is_active ? 'deactivated' : 'activated'}.`, () => setCategoryActive(n.id, !n.is_active))}>
                          {n.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                        {!n.is_system_seeded ? (
                          <span style={{ marginLeft: 6 }}>
                            <Button variant="danger" sm onClick={() => run(`${n.name} deleted.`, () => deleteCategory(n.id))}>Delete</Button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card title="Cuisines" style={{ marginTop: 16 }}>
        <form onSubmit={onAddCuisine} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Input placeholder="Cuisine name" value={cuisineName} onChange={(e) => setCuisineName(e.target.value)} style={{ minWidth: 240 }} />
          <Button type="submit" sm>Add cuisine</Button>
        </form>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {cuisines.map((c) => (
            <Button key={c.id} variant={c.is_active ? 'primary' : 'outline'} sm onClick={() => run(`${c.name} ${c.is_active ? 'hidden from owners' : 'shown to owners'}.`, () => setCuisineActive(c.id, !c.is_active))}>
              {c.name}{c.is_active ? '' : ' (off)'}
            </Button>
          ))}
        </div>
      </Card>
    </Page>
  );
}
