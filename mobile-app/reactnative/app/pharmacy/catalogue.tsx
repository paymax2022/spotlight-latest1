import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Switch, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pill, AlertTriangle } from 'lucide-react-native';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { usePharmacyProducts, useUpsertProduct } from '@/features/pharmacymerchant/hooks';
import type { PharmacyProduct } from '@/features/pharmacymerchant/api';
import { parsePackagingPrice } from '@/features/restaurantmerchant/packagingPrice';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

/**
 * The pharmacist's shelf.
 *
 * Shows what customers CANNOT see as well as what they can — a line taken off
 * sale, or one still pending NAFDAC verification. Those are precisely the ones a
 * merchant needs to act on, and until GET /products/mine existed they were
 * invisible to their own owner: writable, but never readable back.
 *
 * Editing is deliberately limited to price, stock and on-sale. Name, NAFDAC
 * reference and the Rx flag are regulated attributes; changing them silently
 * from a phone is not something this screen should make easy, and the server
 * re-validates every one of them regardless.
 */
export default function PharmacyCatalogueScreen() {
  const q = usePharmacyProducts();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Products" />

      {q.isLoading ? (
        <StateView kind="loading" title="Loading your products" />
      ) : q.isError ? (
        <StateView
          kind="error"
          title="Couldn’t load your products"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => q.refetch()}
        />
      ) : (q.data ?? []).length === 0 ? (
        <StateView
          kind="empty"
          icon="Package"
          title="No products yet"
          message="Products you stock appear here. Customers only see the ones that are on sale and NAFDAC-registered."
        />
      ) : (
        <ScrollView
          contentContainerStyle={s.body}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
        >
          {(q.data ?? []).map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              open={editing === p.id}
              onToggle={() => setEditing(editing === p.id ? null : p.id)}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ProductRow({ product, open, onToggle }: { product: PharmacyProduct; open: boolean; onToggle: () => void }) {
  const upsert = useUpsertProduct();
  const [price, setPrice] = useState(String(product.price_kobo / 100));
  const [stock, setStock] = useState(String(product.stock_qty));
  const [active, setActive] = useState(product.active);
  const [error, setError] = useState<string | null>(null);

  // Reuses the merchant naira→kobo parser: same rounding rule, same reason. A
  // price typed here is what every customer pays.
  const parsedPrice = parsePackagingPrice(price);
  const parsedStock = /^\d+$/.test(stock.trim()) ? Number(stock.trim()) : null;

  // Not sellable to customers, and the owner is the only one who can tell why.
  const offSale = !product.active;
  const unverified = product.nafdac_status !== 'REGISTERED';

  const save = () => {
    if (!parsedPrice.ok) { setError(parsedPrice.error); return; }
    if (parsedPrice.kobo <= 0) { setError('Price must be more than zero.'); return; }
    if (parsedStock === null) { setError('Stock must be a whole number.'); return; }
    setError(null);
    upsert.mutate(
      { ...product, price_kobo: parsedPrice.kobo, stock_qty: parsedStock, active },
      {
        onSuccess: () => onToggle(),
        // The server owns HL-2/HL-4/HL-5; surface its reason rather than guess.
        onError: (e: unknown) => {
          const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setError(msg || 'Couldn’t save that. Try again.');
        },
      },
    );
  };

  return (
    <View style={[s.card, shadow1]}>
      <Pressable onPress={onToggle} style={s.rowTop} accessibilityRole="button">
        <View style={s.iconWrap}>
          <Pill size={17} color={Colors.primary} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name} numberOfLines={1}>{product.name}</Text>
          <Text style={s.muted}>
            {naira(product.price_kobo)} · {product.stock_qty} in stock
            {product.rx_required ? ' · Rx' : ''}
          </Text>
        </View>
        {offSale || unverified ? (
          <View style={s.warnPill}>
            <AlertTriangle size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={s.warnText}>{offSale ? 'Off sale' : 'Pending'}</Text>
          </View>
        ) : null}
      </Pressable>

      {unverified ? (
        <Text style={s.muted}>
          Awaiting NAFDAC verification, so customers can’t see it yet even when it’s on sale.
        </Text>
      ) : null}

      {open ? (
        <View style={s.editor}>
          <View style={s.fieldRow}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={s.label}>Price (₦)</Text>
              <TextInput
                value={price}
                onChangeText={(t) => { setPrice(t); if (error) setError(null); }}
                keyboardType="decimal-pad"
                style={s.input}
                accessibilityLabel={`Price for ${product.name}`}
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={s.label}>Stock</Text>
              <TextInput
                value={stock}
                onChangeText={(t) => { setStock(t); if (error) setError(null); }}
                keyboardType="number-pad"
                style={s.input}
                accessibilityLabel={`Stock for ${product.name}`}
              />
            </View>
          </View>

          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>On sale</Text>
              <Text style={s.muted}>Turn off to hide it from customers without deleting it.</Text>
            </View>
            <Switch
              value={active}
              onValueChange={setActive}
              trackColor={{ true: Colors.primary, false: Colors.outlineVariant }}
            />
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <PrimaryButton
            label="Save"
            onPress={save}
            loading={upsert.isPending}
            disabled={upsert.isPending}
          />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.md, gap: Spacing.sm },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 6,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconWrap: {
    width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow,
  },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  muted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  warnPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm,
    paddingVertical: 3, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow,
  },
  warnText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  editor: { gap: Spacing.sm, marginTop: Spacing.xs },
  fieldRow: { flexDirection: 'row', gap: Spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  input: {
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 10, color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow,
  },
  error: { ...Typography.bodySm, color: Colors.error },
});
