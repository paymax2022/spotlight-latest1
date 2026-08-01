import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Switch, Pressable, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Trash2, Plus, ClipboardList } from 'lucide-react-native';
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
import type { MerchantMenuCategory } from '@/features/restaurantmerchant/types';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

export default function ManageStoreScreen() {
  const stores = useMyStores();
  const store = stores.data?.[0];

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
  return <ManageStore storeId={store.id} />;
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
function ManageStore({ storeId }: { storeId: string }) {
  const detail = useStoreDetail(storeId);
  const update = useUpdateStore(storeId);
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
        {/* Quick link to the live order queue. */}
        <Pressable onPress={() => router.push('/food/restaurant')} style={styles.ordersLink}>
          <ClipboardList size={18} color={Colors.primary} />
          <Text style={styles.ordersLinkText}>View incoming orders</Text>
        </Pressable>

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

        {/* Menu */}
        <Text style={styles.section}>Menu</Text>
        <MenuBuilder storeId={storeId} categories={detail.data?.categories ?? []} />
      </ScrollView>
    </Shell>
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
  const confirmDeleteItem = (itemId: string, itemName: string) =>
    Alert.alert('Remove item', `Delete "${itemName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteItem.mutate(itemId) },
    ]);

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
                  ? Alert.alert('Category not empty', 'Remove its items before deleting the category.')
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
  label, value, onChangeText, placeholder, multiline,
}: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder?: string; multiline?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor={Colors.outline} multiline={multiline}
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
  ordersLink: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: 12,
  },
  ordersLinkText: { color: Colors.primary, fontSize: 15, fontWeight: '700' },
});
