'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getRestaurantDetail,
  updateRestaurant,
  setRestaurantAvailability,
  createMenuCategory,
  deleteMenuCategory,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
} from '@/services/restaurantAdminService';
import type {
  MenuCategory,
  MenuItem,
  Restaurant,
  UpdateRestaurantRequest,
} from '@/types/restaurantAdmin';
import { RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice, naira } from '../_ui';
import { Page, PageHeader, Card, Button, Input, colors, thCell, tdCell } from '@/components/ui/vuexy';

// Admin store detail + menu management.
//
// Talks to /api/restaurant/admin/restaurants/* — NOT the owner-facing member
// routes. Those enforce ownership (Service.assertOwner) with no operator
// exemption, so an admin gets 403 on every mutation there.
//
// All money is integer kobo end to end. The naira <-> kobo conversion happens
// only at the input boundary (parseNaira / toNairaInput) so no float arithmetic
// ever touches a price.

/** Naira string from a form field -> integer kobo. Returns null when unparseable. */
function parseNairaToKobo(v: string): number | null {
  const t = v.trim().replace(/[₦,\s]/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  // Build kobo from the two parts as integers — never `Number(t) * 100`, which
  // loses precision on values like 4200.15.
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

const toNairaInput = (kobo: number) => (kobo / 100).toFixed(2);

export default function RestaurantDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const { can } = useRestaurantPermissions();
  const canManage = can(RESTAURANT_PERMS.manage);

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [profile, setProfile] = useState<UpdateRestaurantRequest>({});
  const [newCategory, setNewCategory] = useState('');
  const [newItem, setNewItem] = useState<{ categoryId: string; name: string; price: string }>({
    categoryId: '', name: '', price: '',
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const d = await getRestaurantDetail(id);
      setRestaurant(d.restaurant);
      setCategories(d.categories ?? []);
      setProfile({
        name: d.restaurant.name,
        description: d.restaurant.description ?? '',
        address: d.restaurant.address ?? '',
        cuisine: d.restaurant.cuisine ?? '',
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load restaurant');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Every mutation funnels through here so in-flight state, error surfacing and
  // reload-on-success are handled once rather than per button.
  async function run(key: string, fn: () => Promise<unknown>, successMsg: string) {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      setNotice(successMsg);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) {
    return (
      <Page>
        <PageHeader title="Restaurant" subtitle="Store profile and menu management." />
        <AccessNotice perm="restaurant.manage" />
      </Page>
    );
  }

  if (loading) {
    return (
      <Page>
        <PageHeader title="Restaurant" />
        <Card><div style={{ color: colors.muted }}>Loading…</div></Card>
      </Page>
    );
  }

  if (error && !restaurant) {
    return (
      <Page>
        <PageHeader title="Restaurant" />
        <Card style={{ color: colors.danger }}>
          <strong>Couldn&apos;t load this restaurant:</strong> {error}
          <div style={{ marginTop: 12 }}>
            <Button variant="outline" onClick={() => void load()}>Retry</Button>
          </div>
        </Card>
      </Page>
    );
  }

  const itemCount = categories.reduce((n, c) => n + (c.items?.length ?? 0), 0);

  return (
    <Page>
      <PageHeader
        title={restaurant?.name ?? 'Restaurant'}
        subtitle={`${restaurant?.cuisine || 'Uncategorised'} · ${categories.length} categories · ${itemCount} items`}
        actions={<Button variant="outline" onClick={() => router.push('/admin/restaurant')}>← All restaurants</Button>}
      />

      {notice && (
        <Card style={{ marginBottom: 16, borderColor: colors.success, color: colors.success }}>{notice}</Card>
      )}
      {error && restaurant && (
        <Card style={{ marginBottom: 16, borderColor: colors.danger, color: colors.danger }}>{error}</Card>
      )}

      {/* ── Availability ─────────────────────────────────────────────────── */}
      <Card title="Availability" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
          <div style={{ fontSize: '0.9rem', color: colors.text }}>
            Currently{' '}
            <strong style={{ color: restaurant?.is_open ? colors.success : colors.danger }}>
              {restaurant?.is_open ? 'OPEN' : 'CLOSED'}
            </strong>
            {' — '}
            <span style={{ color: colors.muted, fontSize: '0.82rem' }}>
              customers {restaurant?.is_open ? 'can' : 'cannot'} place orders.
            </span>
          </div>
          <Button
            variant={restaurant?.is_open ? 'outline' : 'primary'}
            disabled={busy === 'availability'}
            onClick={() =>
              void run('availability',
                () => setRestaurantAvailability(id!, !restaurant?.is_open),
                restaurant?.is_open ? 'Store closed.' : 'Store opened.')
            }
          >
            {busy === 'availability' ? '…' : restaurant?.is_open ? 'Force close' : 'Open store'}
          </Button>
        </div>
        <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: 10 }}>
          Force-closing is the operator override for a store taking orders it cannot fulfil. The
          merchant can reopen from their own app unless you also suspend them.
        </p>
      </Card>

      {/* ── Profile ──────────────────────────────────────────────────────── */}
      <Card title="Store profile" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
          <label style={{ fontSize: '0.8rem', color: colors.muted }}>
            Name
            <Input value={profile.name ?? ''} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </label>
          <label style={{ fontSize: '0.8rem', color: colors.muted }}>
            Cuisine
            <Input value={profile.cuisine ?? ''} onChange={(e) => setProfile({ ...profile, cuisine: e.target.value })} />
          </label>
          <label style={{ fontSize: '0.8rem', color: colors.muted }}>
            Address
            <Input value={profile.address ?? ''} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
          </label>
          <label style={{ fontSize: '0.8rem', color: colors.muted }}>
            Description
            <Input value={profile.description ?? ''} onChange={(e) => setProfile({ ...profile, description: e.target.value })} />
          </label>
        </div>

        {/* Read-only storefront terms. These are set by the merchant / pricing
            console, not here, so they are shown for context rather than edited. */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 14, fontSize: '0.8rem', color: colors.muted }}>
          <span>Min order: <strong style={{ color: colors.text }}>{naira(restaurant?.min_order_kobo ?? 0)}</strong></span>
          <span>Packaging/pack: <strong style={{ color: colors.text }}>{naira(restaurant?.packaging_fee_kobo ?? 0)}</strong></span>
          <span>Prep time: <strong style={{ color: colors.text }}>{restaurant?.prep_time_minutes ?? 0} min</strong></span>
          <span>Rating: <strong style={{ color: colors.text }}>{restaurant?.rating?.toFixed(1) ?? '—'}</strong></span>
        </div>

        <div style={{ marginTop: 14 }}>
          <Button
            disabled={busy === 'profile' || !profile.name?.trim()}
            onClick={() => void run('profile', () => updateRestaurant(id!, profile), 'Profile saved.')}
          >
            {busy === 'profile' ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </Card>

      {/* ── Menu ─────────────────────────────────────────────────────────── */}
      <Card title="Menu" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Input
            placeholder="New category name…"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <Button
            disabled={!newCategory.trim() || busy === 'cat-new'}
            onClick={() =>
              void run('cat-new', async () => {
                await createMenuCategory(id!, newCategory.trim());
                setNewCategory('');
              }, 'Category added.')
            }
          >
            {busy === 'cat-new' ? '…' : 'Add category'}
          </Button>
        </div>

        {categories.length === 0 ? (
          <p style={{ color: colors.muted, marginTop: 16, fontSize: '0.85rem' }}>
            No categories yet. Add one above before adding dishes.
          </p>
        ) : (
          categories.map((cat) => (
            <div key={cat.id} style={{ marginTop: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: '0.98rem', color: colors.text }}>
                  {cat.name}{' '}
                  <span style={{ color: colors.muted, fontWeight: 400, fontSize: '0.82rem' }}>
                    ({cat.items?.length ?? 0})
                  </span>
                </h3>
                <Button
                  variant="outline"
                  sm
                  disabled={busy === `cat-${cat.id}`}
                  title={cat.items?.length ? 'Delete the dishes in this category first' : 'Delete category'}
                  onClick={() =>
                    void run(`cat-${cat.id}`, () => deleteMenuCategory(id!, cat.id), 'Category deleted.')
                  }
                >
                  {busy === `cat-${cat.id}` ? '…' : 'Delete category'}
                </Button>
              </div>

              <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 8 }}>
                <thead>
                  <tr>
                    <th style={thCell}>Dish</th>
                    <th style={thCell}>Price</th>
                    <th style={thCell}>Available</th>
                    <th style={thCell}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(cat.items ?? []).length === 0 ? (
                    <tr><td style={{ ...tdCell, color: colors.muted }} colSpan={4}>No dishes in this category.</td></tr>
                  ) : (
                    cat.items!.map((it) => (
                      <MenuItemRow
                        key={it.id}
                        item={it}
                        busy={busy}
                        onSavePrice={(kobo) =>
                          run(`item-${it.id}`, () => updateMenuItem(id!, it.id, { price_kobo: kobo }), 'Price updated.')
                        }
                        onToggle={() =>
                          run(`item-${it.id}`, () => updateMenuItem(id!, it.id, { is_available: !it.is_available }),
                            it.is_available ? 'Dish hidden.' : 'Dish made available.')
                        }
                        onDelete={() =>
                          run(`item-${it.id}`, () => deleteMenuItem(id!, it.id), 'Dish deleted.')
                        }
                      />
                    ))
                  )}
                </tbody>
              </table>

              {/* Add dish to this category */}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <Input
                  placeholder="Dish name"
                  value={newItem.categoryId === cat.id ? newItem.name : ''}
                  onChange={(e) => setNewItem({ categoryId: cat.id, name: e.target.value, price: newItem.categoryId === cat.id ? newItem.price : '' })}
                  style={{ minWidth: 200 }}
                />
                <Input
                  placeholder="Price (₦)"
                  inputMode="decimal"
                  value={newItem.categoryId === cat.id ? newItem.price : ''}
                  onChange={(e) => setNewItem({ categoryId: cat.id, name: newItem.categoryId === cat.id ? newItem.name : '', price: e.target.value })}
                  style={{ maxWidth: 140 }}
                />
                <Button
                  variant="outline"
                  disabled={
                    busy === `item-new-${cat.id}` ||
                    newItem.categoryId !== cat.id ||
                    !newItem.name.trim() ||
                    parseNairaToKobo(newItem.price) === null
                  }
                  title={
                    newItem.categoryId === cat.id && newItem.price && parseNairaToKobo(newItem.price) === null
                      ? 'Enter a price like 3500 or 3500.50'
                      : 'Add dish'
                  }
                  onClick={() =>
                    void run(`item-new-${cat.id}`, async () => {
                      const kobo = parseNairaToKobo(newItem.price);
                      if (kobo === null) throw new Error('Invalid price');
                      await createMenuItem(id!, {
                        category_id: cat.id,
                        name: newItem.name.trim(),
                        price_kobo: kobo,
                      });
                      setNewItem({ categoryId: '', name: '', price: '' });
                    }, 'Dish added.')
                  }
                >
                  {busy === `item-new-${cat.id}` ? '…' : 'Add dish'}
                </Button>
              </div>
            </div>
          ))
        )}
      </Card>

      <p style={{ fontSize: '0.78rem', color: colors.muted }}>
        All prices are integer kobo server-side. Changes here apply to the merchant&apos;s live
        storefront immediately and are made under your operator identity, not theirs.
      </p>
    </Page>
  );
}

// One editable dish row. Price edits are staged locally so a mistyped digit
// doesn't fire a request per keystroke; Save commits.
function MenuItemRow({
  item, busy, onSavePrice, onToggle, onDelete,
}: {
  item: MenuItem;
  busy: string | null;
  onSavePrice: (kobo: number) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [price, setPrice] = useState(toNairaInput(item.price_kobo));
  useEffect(() => { setPrice(toNairaInput(item.price_kobo)); }, [item.price_kobo]);

  const parsed = parseNairaToKobo(price);
  const dirty = parsed !== null && parsed !== item.price_kobo;
  const isBusy = busy === `item-${item.id}`;

  return (
    <tr>
      <td style={tdCell}>
        <strong>{item.name}</strong>
        {item.description && (
          <div style={{ color: colors.muted, fontSize: '0.78rem' }}>{item.description}</div>
        )}
      </td>
      <td style={tdCell}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Input
            value={price}
            inputMode="decimal"
            onChange={(e) => setPrice(e.target.value)}
            style={{ maxWidth: 110 }}
          />
          {dirty && (
            <Button sm disabled={isBusy} onClick={() => onSavePrice(parsed!)}>
              {isBusy ? '…' : 'Save'}
            </Button>
          )}
          {parsed === null && price.trim() !== '' && (
            <span style={{ color: colors.danger, fontSize: '0.72rem' }}>invalid</span>
          )}
        </div>
      </td>
      <td style={tdCell}>
        <span style={{ color: item.is_available ? colors.success : colors.muted, fontSize: '0.82rem' }}>
          {item.is_available ? 'Available' : 'Hidden'}
        </span>
      </td>
      <td style={tdCell}>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button variant="outline" sm disabled={isBusy} onClick={onToggle}>
            {item.is_available ? 'Hide' : 'Show'}
          </Button>
          <Button variant="outline" sm disabled={isBusy} onClick={onDelete}>
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
}
