import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Switch, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import { Trash2, Plus, ClipboardList, Wallet, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import AddressAutocompleteInput, { type SelectedAddress } from '@/components/AddressAutocompleteInput';
import {
  useMyStores, useStoreDetail, useCreateStore, useUpdateStore, useSetAvailability,
  useCreateCategory, useDeleteCategory, useCreateItem, useDeleteItem, usePayoutReadiness,
} from '@/features/restaurantmerchant/hooks';
import type { MerchantMenuCategory, MerchantStore, StoreGeoPoint } from '@/features/restaurantmerchant/types';
import { parsePackagingPrice, packagingPriceInput } from '@/features/restaurantmerchant/packagingPrice';
import { resolveActiveOutlet } from '@/features/restaurantmerchant/activeOutlet';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

// ── Availability ↔ KYB messaging ─────────────────────────────────────────────
//
// Opening for orders requires an APPROVED business verification (KYB) — see
// backend SetAvailability (ADR-033, fail-closed): closing is always allowed,
// but the backend rejects turning the switch ON with
// "business verification must be approved before opening for orders" until
// `restaurants.kyb_status = 'approved'`. Until this notice existed the owner
// had zero signal anywhere on this screen for WHY the switch wouldn't turn on
// — the PayoutReadinessBanner below covers payouts, not opening, and reports
// on a separate concern. This turns the same kybStatus (already fetched via
// usePayoutReadiness for that banner) into a status-specific, actionable
// message so the owner knows whether to wait or to act.
function availabilityKybNotice(
  kybStatus: string | undefined,
): { title: string; message: string; actionLabel?: string } | null {
  if (!kybStatus || kybStatus === 'approved') return null;
  switch (kybStatus) {
    case 'submitted':
    case 'under_review':
      return {
        title: 'Verification in review',
        message: "Your business verification is being reviewed. This usually takes a few days — no action needed. We'll let you know the moment it's approved so you can open for orders.",
        actionLabel: 'View status',
      };
    case 'needs_more_info':
      return {
        title: 'More information needed',
        message: 'Your business verification needs more details before it can be approved.',
        actionLabel: 'Update verification',
      };
    case 'rejected':
      return {
        title: 'Verification declined',
        message: 'Your business verification was declined, so orders stay off until it is resolved.',
        actionLabel: 'Reapply',
      };
    case 'none':
    case 'draft':
    default:
      return {
        title: 'Business verification required',
        message: "You haven't completed business verification yet, so you can't open for orders.",
        actionLabel: 'Complete verification',
      };
  }
}

export default function ManageStoreScreen() {
  const stores = useMyStores();
  // Which outlet the console acts on. This used to be `stores.data?.[0]`, so an
  // owner running several restaurants could only ever manage the first — while
  // the order queue already spanned them all. 61 owners in the live data run
  // 2–3 outlets.
  const [outletId, setOutletId] = useState<string | null>(null);
  const { active: store, multi, outlets } = resolveActiveOutlet(stores.data, outletId);

  if (stores.isLoading) {
    return (
      <Shell>
        <StateView kind="loading" title="Loading your store" />
      </Shell>
    );
  }
  if (stores.isError) {
    return (
      <Shell>
        <StateView kind="error" title="Couldn't load your store" message="Pull to retry or check your connection."
          actionLabel="Retry" onAction={() => stores.refetch()} />
      </Shell>
    );
  }
  if (!store) return <CreateStore onDone={() => stores.refetch()} />;
  return (
    <ManageStore
      storeId={store.id}
      outlets={outlets}
      activeOutletId={store.id}
      onSwitchOutlet={setOutletId}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Manage Store" />
      {children}
    </SafeAreaView>
  );
}

// ── First-run: create the store ───────────────────────────────────────────────
function CreateStore({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [geo, setGeo] = useState<StoreGeoPoint | null>(null);
  const create = useCreateStore();
  const submit = () => {
    if (!name.trim() || !address.trim()) return;
    create.mutate(
      { name: name.trim(), address: address.trim(), geo: geo ?? undefined },
      { onSuccess: onDone },
    );
  };
  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lead}>Set up your restaurant to start receiving orders.</Text>
        <Card>
          <Field label="Restaurant name" value={name} onChangeText={setName} placeholder="Blue Yam Kitchen" />
          <AddressField
            label="Address"
            value={address}
            onChangeText={(t) => { setAddress(t); setGeo(null); }}
            geo={geo}
            onGeoChange={setGeo}
            placeholder="12 Marina, Lagos"
          />
        </Card>
        <PrimaryButton label="Create store" onPress={submit}
          loading={create.isPending} disabled={!name.trim() || !address.trim()} />
      </ScrollView>
    </Shell>
  );
}

// ── Manage an existing store ──────────────────────────────────────────────────
function ManageStore({
  storeId, outlets, activeOutletId, onSwitchOutlet,
}: {
  storeId: string;
  /** Every outlet the owner runs. Chips render only when there is more than one,
   *  but "Add outlet" is offered either way — that is how a second one appears. */
  outlets: MerchantStore[];
  activeOutletId: string;
  onSwitchOutlet: (id: string) => void;
}) {
  const detail = useStoreDetail(storeId);
  const update = useUpdateStore(storeId);
  const createOutlet = useCreateStore();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newGeo, setNewGeo] = useState<StoreGeoPoint | null>(null);
  const availability = useSetAvailability(storeId);
  const readiness = usePayoutReadiness();
  const kybStatus = readiness.data?.find((o) => o.restaurantId === storeId)?.kybStatus;
  const kybNotice = availabilityKybNotice(kybStatus);

  const server = detail.data?.store;
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  // Untouched until the owner picks a place or types over the address — see
  // geoVal below for why this needs its own "touched" flag rather than
  // reusing `address == null` the way the other fields do.
  const [geoTouched, setGeoTouched] = useState(false);
  const [geo, setGeo] = useState<StoreGeoPoint | null>(null);

  // Fall back to server values until the field is edited.
  const nameVal = name ?? server?.name ?? '';
  const descVal = description ?? server?.description ?? '';
  const addrVal = address ?? server?.address ?? '';
  // Same fallback, but a plain `?? server pin` would be wrong once the owner
  // retypes the address by hand: that clears any confirmed pin (geo becomes
  // null on purpose), and `null ?? serverPin` would silently resurrect the
  // stale one. geoTouched distinguishes "never touched" from "touched, and
  // now has no pin".
  const serverGeo = server?.geoLat != null && server?.geoLng != null
    ? { lat: server.geoLat, lng: server.geoLng } : null;
  const geoVal = geoTouched ? geo : serverGeo;
  const dirty = useMemo(
    () => server != null && (
      nameVal !== server.name
      || descVal !== (server.description ?? '')
      || addrVal !== server.address
      || (geoTouched && (geoVal?.lat !== serverGeo?.lat || geoVal?.lng !== serverGeo?.lng))
    ),
    [server, nameVal, descVal, addrVal, geoTouched, geoVal, serverGeo],
  );

  const saveProfile = () => {
    if (!nameVal.trim()) return;
    update.mutate(
      { name: nameVal.trim(), description: descVal, address: addrVal.trim(), geo: geoTouched ? (geoVal ?? undefined) : undefined },
      { onSuccess: () => { setName(null); setDescription(null); setAddress(null); setGeoTouched(false); setGeo(null); } },
    );
  };

  if (detail.isLoading) return <Shell><StateView kind="loading" title="Loading store" /></Shell>;
  if (detail.isError || !server) {
    return <Shell><StateView kind="error" title="Couldn't load store"
      actionLabel="Retry" onAction={() => detail.refetch()} /></Shell>;
  }

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.body}>
        {/* Outlet switcher — only when the owner runs more than one. Every section
            below (profile, packaging, menu) acts on the selected outlet, so this
            is the control that decides which shop gets edited. */}
        {outlets.length > 0 && (
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>{outlets.length > 1 ? 'Outlet' : 'Your outlets'}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.xs }}>
              {(outlets.length > 1 ? outlets : []).map((o) => {
                const selected = o.id === activeOutletId;
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => onSwitchOutlet(o.id)}
                    style={[styles.outletChip, selected && styles.outletChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Manage ${o.name}${o.isOpen ? '' : ', closed'}`}
                  >
                    <Text style={[styles.outletChipText, selected && styles.outletChipTextOn]} numberOfLines={1}>
                      {o.name}
                    </Text>
                    {!o.isOpen && <Text style={styles.outletChipClosed}>Closed</Text>}
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setAdding(true)}
                style={[styles.outletChip, styles.outletChipAdd]}
                accessibilityRole="button"
                accessibilityLabel="Add another outlet"
              >
                <Plus size={14} color={Colors.primary} />
                <Text style={styles.outletChipTextOn}>Add outlet</Text>
              </Pressable>
            </ScrollView>
          </View>
        )}

        {adding && (
          <Card>
            <Text style={styles.cardTitle}>New outlet</Text>
            <Text style={styles.muted}>
              A separate shop with its own menu, hours and packaging price. Orders for every
              outlet arrive in the same queue.
            </Text>
            <Field label="Outlet name" value={newName} onChangeText={setNewName} placeholder="Blue Yam — Lekki" />
            <AddressField
              label="Address"
              value={newAddress}
              onChangeText={(t) => { setNewAddress(t); setNewGeo(null); }}
              geo={newGeo}
              onGeoChange={setNewGeo}
              placeholder="12 Admiralty Way, Lekki"
            />
            <PrimaryButton
              label="Create outlet"
              onPress={() => {
                if (!newName.trim() || !newAddress.trim()) return;
                createOutlet.mutate(
                  { name: newName.trim(), address: newAddress.trim(), geo: newGeo ?? undefined },
                  {
                    onSuccess: (created) => {
                      setAdding(false); setNewName(''); setNewAddress(''); setNewGeo(null);
                      // Switch straight to the new outlet: the owner created it to
                      // work on it, and leaving them on the old one reads as failure.
                      if (created?.id) onSwitchOutlet(created.id);
                    },
                  },
                );
              }}
              loading={createOutlet.isPending}
              disabled={!newName.trim() || !newAddress.trim()}
            />
            <Pressable onPress={() => setAdding(false)} accessibilityRole="button">
              <Text style={styles.muted}>Cancel</Text>
            </Pressable>
          </Card>
        )}

        <PayoutReadinessBanner storeId={storeId} />

        {/* Quick links to orders + earnings. */}
        <View style={styles.linkRow}>
          <Pressable onPress={() => router.push('/food/restaurant')} style={[styles.ordersLink, { flex: 1 }]}>
            <ClipboardList size={18} color={Colors.primary} />
            <Text style={styles.ordersLinkText}>Orders</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/food/restaurant/earnings')} style={[styles.ordersLink, { flex: 1 }]}>
            <Wallet size={18} color={Colors.primary} />
            <Text style={styles.ordersLinkText}>Earnings</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push(`/food/restaurant/staff?outlet=${storeId}`)}
            style={[styles.ordersLink, { flex: 1 }]}
          >
            <Users size={18} color={Colors.primary} />
            <Text style={styles.ordersLinkText}>Staff</Text>
          </Pressable>
        </View>

        {/* Availability */}
        <Card>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{server.isOpen ? 'Open for orders' : 'Closed'}</Text>
              <Text style={styles.muted}>
                {server.isOpen ? 'Customers can order now.' : 'Turn on to start receiving orders.'}
              </Text>
            </View>
            <Switch
              value={server.isOpen}
              disabled={availability.isPending}
              onValueChange={(v) =>
                availability.mutate(v, {
                  onError: async (e) => {
                    if (kybNotice) {
                      const go = await confirmAsync({
                        title: kybNotice.title,
                        message: kybNotice.message,
                        confirmLabel: kybNotice.actionLabel ?? 'OK',
                        cancelLabel: 'Not now',
                      });
                      if (go) router.push(`/food/restaurant/kyb?outlet=${storeId}`);
                      return;
                    }
                    alertAsync({
                      title: "Couldn't update store status",
                      message: (e as Error)?.message ?? 'Please try again.',
                    });
                  },
                })
              }
              trackColor={{ true: Colors.primary, false: Colors.outlineVariant }}
            />
          </View>
          {/* Why the switch won't turn on, when it's KYB and not something transient —
              shown proactively so the owner never has to tap it just to find out. */}
          {!server.isOpen && kybNotice && (
            <View style={[styles.payoutWarn, { marginTop: Spacing.sm }]} accessibilityRole="alert">
              <Text style={styles.payoutWarnTitle}>{kybNotice.title}</Text>
              <Text style={styles.muted}>{kybNotice.message}</Text>
              {kybNotice.actionLabel && (
                <Pressable onPress={() => router.push(`/food/restaurant/kyb?outlet=${storeId}`)} hitSlop={8}>
                  <Text style={styles.kybLink}>{kybNotice.actionLabel} →</Text>
                </Pressable>
              )}
            </View>
          )}
        </Card>

        {/* Profile */}
        <Text style={styles.section}>Store details</Text>
        <Card>
          <Field label="Restaurant name" value={nameVal} onChangeText={setName} placeholder="Blue Yam Kitchen" />
          <Field label="Description" value={descVal} onChangeText={setDescription} placeholder="What you're known for" multiline />
          <AddressField
            label="Address"
            value={addrVal}
            onChangeText={(t) => { setAddress(t); setGeoTouched(true); setGeo(null); }}
            geo={geoVal}
            onGeoChange={(g) => { setGeoTouched(true); setGeo(g); }}
            near={serverGeo ?? undefined}
            placeholder="12 Marina, Lagos"
          />
          <PrimaryButton label="Save changes" onPress={saveProfile}
            loading={update.isPending} disabled={!dirty || !nameVal.trim()} />
        </Card>

        {/* Packaging */}
        <Text style={styles.section}>Takeaway packaging</Text>
        <PackagingPrice storeId={storeId} store={server} />

        {/* Menu */}
        <Text style={styles.section}>Menu</Text>
        <MenuBuilder storeId={storeId} categories={detail.data?.categories ?? []} />
      </ScrollView>
    </Shell>
  );
}

// ── Payout readiness (capability ↔ KYB bridge) ───────────────────────────────
//
// Trading and being PAID are gated separately: the merchant capability lets a
// person trade, while payout runs select `kyb_status = 'approved'` per outlet
// (PY-007). Until now nothing joined them, so an outlet could take orders, settle
// them, and be skipped by every payout run with no signal at all — 709 outlets
// are in exactly that state.
//
// Shown only when this outlet is blocked. A banner that appears when everything
// is fine is noise, and gets ignored when it matters.
function PayoutReadinessBanner({ storeId }: { storeId: string }) {
  const readiness = usePayoutReadiness();
  const mine = readiness.data?.find((o) => o.restaurantId === storeId);
  if (!mine || mine.payable) return null;

  return (
    <View style={styles.payoutWarn} accessibilityRole="alert">
      <Text style={styles.payoutWarnTitle}>Payouts are on hold for this outlet</Text>
      <Text style={styles.muted}>{mine.reason}</Text>
      {mine.unpaidKobo > 0 && (
        <Text style={styles.payoutWarnAmount}>
          {naira(mine.unpaidKobo)} already earned is waiting to be paid out.
        </Text>
      )}
    </View>
  );
}

// ── Takeaway packaging price ──────────────────────────────────────────────────
//
// The customer pays this ONCE PER PACK, so the owner is setting a price every
// future order carries — worth its own card rather than a fourth input buried in
// the profile form. The copy says where the money goes, because the honest answer
// is unusually good for the merchant: all of it, with no platform or rider cut.
function PackagingPrice({ storeId, store }: { storeId: string; store: MerchantStore }) {
  const update = useUpdateStore(storeId);
  const serverKobo = store.packagingFeeKobo;

  // null while untouched, so the field tracks the server value until the owner
  // actually edits it — the same pattern the profile form above uses.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `?? undefined` deliberately: an older payload that omits the field is UNKNOWN,
  // and seeding the box with "0" would invite the owner to save a price of free
  // that they never chose.
  const serverInput = serverKobo === undefined ? '' : packagingPriceInput(serverKobo);
  const value = draft ?? serverInput;

  const parsed = parsePackagingPrice(value);
  const dirty = value !== serverInput;
  const canSave = dirty && parsed.ok && !update.isPending;

  const save = () => {
    const result = parsePackagingPrice(value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    update.mutate(
      { packagingFeeKobo: result.kobo },
      {
        // Drop back to tracking the server, so what is displayed is what was
        // actually saved rather than what was typed.
        onSuccess: () => setDraft(null),
        onError: () => setError('Couldn’t save that price. Check your connection and try again.'),
      },
    );
  };

  const perPack = parsed.ok ? parsed.kobo : null;

  return (
    <Card>
      <Text style={styles.muted}>
        Charged once for every takeaway pack in an order. You keep all of it — Paymax and the
        rider take no cut.
      </Text>

      <Field
        label="Price per pack (₦)"
        value={value}
        onChangeText={(t) => { setDraft(t); if (error) setError(null); }}
        placeholder="200"
        keyboardType="decimal-pad"
      />

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : perPack !== null ? (
        <Text style={styles.muted}>
          {perPack === 0
            ? 'Customers won’t be charged for packaging.'
            : `A 3-pack order adds ${naira(perPack * 3)} for the customer.`}
        </Text>
      ) : null}

      <PrimaryButton
        label="Save packaging price"
        onPress={save}
        loading={update.isPending}
        disabled={!canSave}
      />
    </Card>
  );
}

// ── Menu builder ──────────────────────────────────────────────────────────────
function MenuBuilder({ storeId, categories }: { storeId: string; categories: MerchantMenuCategory[] }) {
  const [newCat, setNewCat] = useState('');
  const createCat = useCreateCategory(storeId);
  const deleteCat = useDeleteCategory(storeId);
  const deleteItem = useDeleteItem(storeId);

  const addCategory = () => {
    if (!newCat.trim()) return;
    createCat.mutate(newCat.trim(), { onSuccess: () => setNewCat('') });
  };
  const confirmDeleteItem = async (itemId: string, itemName: string) => {
    const ok = await confirmAsync({ title: 'Remove item', message: `Delete "${itemName}"?`, confirmLabel: 'Delete', destructive: true });
    if (ok) deleteItem.mutate(itemId);
  };

  return (
    <View style={{ gap: Spacing.md }}>
      {categories.length === 0 ? (
        <Text style={styles.muted}>No categories yet. Add one below to start building your menu.</Text>
      ) : null}

      {categories.map((cat) => (
        <Card key={cat.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{cat.name}</Text>
            <Pressable
              onPress={() =>
                cat.items.length > 0
                  ? alertAsync({ title: 'Category not empty', message: 'Remove its items before deleting the category.' })
                  : deleteCat.mutate(cat.id)
              }
              hitSlop={8}
            >
              <Trash2 size={18} color={Colors.error} />
            </Pressable>
          </View>

          {cat.items.map((it) => (
            <View key={it.id} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{it.name}</Text>
                <Text style={styles.muted}>{naira(it.priceKobo)}{it.isAvailable ? '' : ' · unavailable'}</Text>
              </View>
              <Pressable onPress={() => confirmDeleteItem(it.id, it.name)} hitSlop={8}>
                <Trash2 size={16} color={Colors.outline} />
              </Pressable>
            </View>
          ))}

          <AddItem storeId={storeId} categoryId={cat.id} />
        </Card>
      ))}

      {/* Add category */}
      <Card>
        <Text style={styles.cardTitle}>Add a category</Text>
        <View style={styles.inlineRow}>
          <TextInput
            value={newCat} onChangeText={setNewCat} placeholder="e.g. Mains"
            placeholderTextColor={Colors.outline} style={[styles.input, { flex: 1 }]}
          />
          <Pressable onPress={addCategory} style={styles.addBtn} disabled={createCat.isPending}>
            <Plus size={18} color="#fff" />
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

function AddItem({ storeId, categoryId }: { storeId: string; categoryId: string }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const createItem = useCreateItem(storeId);
  const add = () => {
    const amount = Number(price);
    if (!name.trim() || !Number.isFinite(amount) || amount <= 0) return;
    createItem.mutate(
      { categoryId, name: name.trim(), priceKobo: Math.round(amount * 100) },
      { onSuccess: () => { setName(''); setPrice(''); } },
    );
  };
  return (
    <View style={styles.inlineRow}>
      <TextInput value={name} onChangeText={setName} placeholder="Item name"
        placeholderTextColor={Colors.outline} style={[styles.input, { flex: 2 }]} />
      <TextInput value={price} onChangeText={setPrice} placeholder="₦ price" keyboardType="numeric"
        placeholderTextColor={Colors.outline} style={[styles.input, { flex: 1 }]} />
      <Pressable onPress={add} style={styles.addBtn} disabled={createItem.isPending}>
        {createItem.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Plus size={18} color="#fff" />}
      </Pressable>
    </View>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────────
function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Field({
  label, value, onChangeText, placeholder, multiline, keyboardType,
}: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder?: string; multiline?: boolean;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor={Colors.outline} multiline={multiline} keyboardType={keyboardType}
        style={[styles.input, multiline && { height: 76, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

/**
 * Address field for a store's own location (create / new outlet / edit profile).
 * Wraps the shared map-backed AddressAutocompleteInput so the owner gets live
 * suggestions + confirm-on-map instead of a plain text box.
 *
 * `geo` is lifted to the caller (not local state) because the resolved pin is
 * more than UI state here: CreateRestaurant/UpdateRestaurant both accept an
 * optional geo_lat/geo_lng/plus_code and, when present, write it directly
 * instead of re-geocoding the address text — a pin the owner confirmed on the
 * map beats a rooftop-centroid guess from the string alone. `onChangeText`
 * must itself clear the caller's geo when the owner types over a resolved
 * address (see each call site), same as any other invalidated-on-edit field.
 *
 * Recent-address chips are switched off: those are a customer's past DELIVERY
 * spots, not relevant when an owner is entering their own restaurant's fixed
 * address.
 */
function AddressField({
  label, value, onChangeText, geo, onGeoChange, near, placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  geo: StoreGeoPoint | null;
  onGeoChange: (geo: StoreGeoPoint | null) => void;
  near?: { lat: number; lng: number };
  placeholder?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <AddressAutocompleteInput
        value={value}
        onChangeText={onChangeText}
        onSelect={(a: SelectedAddress) => {
          onChangeText(a.label);
          onGeoChange({ lat: a.lat, lng: a.lng, plusCode: a.plusCode });
        }}
        near={near}
        resolved={Boolean(geo)}
        surface="checkout"
        placeholder={placeholder}
        enableRecents={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },
  lead: { color: Colors.onSurfaceVariant, fontSize: 15 },
  section: { color: Colors.onSurface, fontSize: 16, fontWeight: '700', marginTop: Spacing.sm },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    gap: Spacing.sm, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  cardTitle: { color: Colors.onSurface, fontSize: 16, fontWeight: '700' },
  muted: { color: Colors.onSurfaceVariant, fontSize: 13 },
  errorText: { color: Colors.error, fontSize: 13 },
  outletChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 220,
    paddingHorizontal: Spacing.sm, paddingVertical: 8, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  outletChipOn: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  outletChipAdd: { borderStyle: 'dashed', borderColor: Colors.primary },
  payoutWarn: {
    gap: 4, padding: Spacing.md, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.error, backgroundColor: Colors.surfaceContainerLowest,
  },
  payoutWarnTitle: { color: Colors.error, fontSize: 14, fontWeight: '700' },
  payoutWarnAmount: { color: Colors.onSurface, fontSize: 13, fontWeight: '600' },
  kybLink: { color: Colors.primary, fontSize: 13, fontWeight: '700', marginTop: 2 },
  outletChipText: { color: Colors.onSurfaceVariant, fontSize: 13, fontWeight: '600' },
  outletChipTextOn: { color: Colors.primary },
  outletChipClosed: { color: Colors.onSurfaceVariant, fontSize: 11 },
  label: { color: Colors.onSurfaceVariant, fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 10, color: Colors.onSurface, fontSize: 15,
    backgroundColor: Colors.background,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  itemName: { color: Colors.onSurface, fontSize: 15, fontWeight: '600' },
  addBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md, height: 44, width: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  linkRow: { flexDirection: 'row', gap: Spacing.sm },
  ordersLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: 12,
  },
  ordersLinkText: { color: Colors.primary, fontSize: 15, fontWeight: '700' },
});
