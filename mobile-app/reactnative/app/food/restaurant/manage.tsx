import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Switch, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import { Trash2, Plus, ClipboardList, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import {
  useMyStores, useStoreDetail, useCreateStore, useUpdateStore, useSetAvailability,
  useCreateCategory, useDeleteCategory, useCreateItem, useDeleteItem,
} from '@/features/restaurantmerchant/hooks';
import type { MerchantMenuCategory, MerchantStore } from '@/features/restaurantmerchant/types';
import { parsePackagingPrice, packagingPriceInput } from '@/features/restaurantmerchant/packagingPrice';
import { resolveActiveOutlet } from '@/features/restaurantmerchant/activeOutlet';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

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
  const create = useCreateStore();
  const submit = () => {
    if (!name.trim() || !address.trim()) return;
    create.mutate({ name: name.trim(), address: address.trim() }, { onSuccess: onDone });
  };
  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lead}>Set up your restaurant to start receiving orders.</Text>
        <Card>
          <Field label="Restaurant name" value={name} onChangeText={setName} placeholder="Blue Yam Kitchen" />
          <Field label="Address" value={address} onChangeText={setAddress} placeholder="12 Marina, Lagos" />
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
  const availability = useSetAvailability(storeId);

  const server = detail.data?.store;
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  // Fall back to server values until the field is edited.
  const nameVal = name ?? server?.name ?? '';
  const descVal = description ?? server?.description ?? '';
  const addrVal = address ?? server?.address ?? '';
  const dirty = useMemo(
    () => server != null && (nameVal !== server.name || descVal !== (server.description ?? '') || addrVal !== server.address),
    [server, nameVal, descVal, addrVal],
  );

  const saveProfile = () => {
    if (!nameVal.trim()) return;
    update.mutate(
      { name: nameVal.trim(), description: descVal, address: addrVal.trim() },
      { onSuccess: () => { setName(null); setDescription(null); setAddress(null); } },
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
            <Field label="Address" value={newAddress} onChangeText={setNewAddress} placeholder="12 Admiralty Way, Lekki" />
            <PrimaryButton
              label="Create outlet"
              onPress={() => {
                if (!newName.trim() || !newAddress.trim()) return;
                createOutlet.mutate(
                  { name: newName.trim(), address: newAddress.trim() },
                  {
                    onSuccess: (created) => {
                      setAdding(false); setNewName(''); setNewAddress('');
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
              onValueChange={(v) => availability.mutate(v)}
              trackColor={{ true: Colors.primary, false: Colors.outlineVariant }}
            />
          </View>
        </Card>

        {/* Profile */}
        <Text style={styles.section}>Store details</Text>
        <Card>
          <Field label="Restaurant name" value={nameVal} onChangeText={setName} placeholder="Blue Yam Kitchen" />
          <Field label="Description" value={descVal} onChangeText={setDescription} placeholder="What you're known for" multiline />
          <Field label="Address" value={addrVal} onChangeText={setAddress} placeholder="12 Marina, Lagos" />
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
