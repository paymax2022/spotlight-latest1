import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, ScrollText, Plus, Boxes, CircleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useMyPharmacy, useProviderCatalog } from '@/features/health/pharmacy/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';
import type { CatalogStockItem } from '@/features/health/pharmacy/types';

/** What a patient can actually do with this line right now. The shelf carries
 *  more states than "in stock": an unlisted line, one still awaiting NAFDAC
 *  registration, and a tracked product that has sold out all read differently. */
function availabilityOf(item: CatalogStockItem): { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
  if (!item.active) return { label: 'Off shelf', tone: 'muted' };
  if (item.nafdacStatus && item.nafdacStatus !== 'REGISTERED') return { label: 'NAFDAC pending', tone: 'warn' };
  if (!item.inStock) return { label: 'Sold out', tone: 'bad' };
  // stock 0 is the untracked default, not an empty shelf.
  return item.stock > 0
    ? { label: `${item.stock} in stock`, tone: 'ok' }
    : { label: 'Not tracked', tone: 'ok' };
}

const TONE: Record<'ok' | 'warn' | 'bad' | 'muted', { bg: string; fg: string }> = {
  ok: { bg: Colors.iconBgTeal, fg: Colors.teal },
  warn: { bg: Colors.iconBgGold, fg: Colors.onWarning },
  bad: { bg: Colors.iconBgRed, fg: Colors.error },
  muted: { bg: Colors.surfaceContainerHigh, fg: Colors.onSurfaceVariant },
};

export default function ProviderCatalogScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useProviderCatalog();
  const { data: mine } = useMyPharmacy();

  const addBtn = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add product"
      hitSlop={10}
      style={styles.addBtn}
      onPress={() => router.push('/health/pharmacy/provider/add-product')}
    >
      <Plus size={20} color={Colors.primary} strokeWidth={2.2} />
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Inventory" subtitle="Listed products & stock" rightSlot={addBtn} />

      {isLoading ? (
        <StateView kind="loading" message="Loading inventory…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load inventory" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(p) => p.productId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListHeaderComponent={
            <>
              <View style={styles.infoStrip}>
                <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
                <Text style={styles.infoText}>Only NAFDAC-registered products can be listed (HL-5).</Text>
              </View>
              {/* HL-2: the write path needs the approved pharmacy row, so say up
                  front when this account has nothing to list into. */}
              {mine && !mine.providerId ? (
                <View style={[styles.infoStrip, styles.infoStripWarn]}>
                  <CircleAlert size={16} color={Colors.onWarning} strokeWidth={2} />
                  <Text style={[styles.infoText, { color: Colors.onWarning }]}>
                    {mine.businessName
                      ? `${mine.businessName} is still being verified — you can prepare lines here, but only an approved pharmacy can list products.`
                      : 'Once your pharmacy is verified you can list products here.'}
                  </Text>
                </View>
              ) : null}
            </>
          }
          renderItem={({ item }: { item: CatalogStockItem }) => {
            const avail = availabilityOf(item);
            const tone = TONE[avail.tone];
            return (
              <Pressable
                style={({ pressed }) => [styles.card, shadow1, pressed && styles.cardPressed]}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.name}`}
                onPress={() => router.push({ pathname: '/health/pharmacy/provider/add-product', params: { id: item.productId } })}
              >
                <View style={styles.head}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    {item.form ? <Text style={styles.form} numberOfLines={1}>{item.form}</Text> : null}
                  </View>
                  <View style={[styles.pill, { backgroundColor: tone.bg }]}>
                    <Text style={[styles.pillText, { color: tone.fg }]}>{avail.label}</Text>
                  </View>
                </View>

                <View style={styles.tags}>
                  <View style={styles.tag}>
                    <ShieldCheck size={13} color={Colors.teal} strokeWidth={2.2} />
                    <Text style={[styles.tagText, { color: Colors.teal }]}>NAFDAC {item.nafdacReg || '—'}</Text>
                  </View>
                  {item.rxRequired ? (
                    <View style={styles.tag}>
                      <ScrollText size={13} color={Colors.secondary} strokeWidth={2.2} />
                      <Text style={[styles.tagText, { color: Colors.secondary }]}>Rx required</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.footerRow}>
                  <Text style={styles.price}>{formatNaira(item.priceKobo)}</Text>
                  <View style={styles.stockRow}>
                    <Boxes size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    <Text style={styles.stock}>
                      {item.stock > 0 ? `${item.stock} tracked` : 'Quantity not tracked'}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="Boxes"
              title="Nothing on the shelf"
              message="Add a NAFDAC-registered product to start selling (HL-5)."
              actionLabel="Add product"
              onAction={() => router.push('/health/pharmacy/provider/add-product')}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100, flexGrow: 1 },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  infoStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  infoStripWarn: { backgroundColor: Colors.iconBgGold },
  infoText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardPressed: { backgroundColor: Colors.surfaceContainerLow },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  form: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: Spacing.sm + 2, paddingVertical: 4, borderRadius: Radius.full },
  pillText: { ...Typography.labelSm, fontWeight: '700' as const },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagText: { ...Typography.labelSm, fontWeight: '600' as const },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price: { ...Typography.titleMd, fontSize: 16, color: Colors.primary },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stock: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
