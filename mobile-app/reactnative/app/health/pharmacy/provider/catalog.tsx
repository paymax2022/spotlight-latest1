import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, ScrollText, Plus, Boxes } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useProviderCatalog } from '@/features/health/pharmacy/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';
import type { CatalogStockItem } from '@/features/health/pharmacy/types';

export default function ProviderCatalogScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useProviderCatalog();

  const addBtn = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add product"
      hitSlop={10}
      style={styles.addBtn}
      onPress={() => {
        /* HL-5: product listing requires NAFDAC verification — add flow lives elsewhere. */
      }}
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
            <View style={styles.infoStrip}>
              <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.infoText}>Only NAFDAC-registered products can be listed (HL-5).</Text>
            </View>
          }
          renderItem={({ item }: { item: CatalogStockItem }) => {
            const low = item.stock <= item.reorderLevel;
            return (
              <View style={[styles.card, shadow1]}>
                <View style={styles.head}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.form} numberOfLines={1}>{item.form}</Text>
                  </View>
                  <View style={[styles.pill, item.active ? styles.pillActive : styles.pillInactive]}>
                    <Text style={[styles.pillText, { color: item.active ? Colors.teal : Colors.onSurfaceVariant }]}>
                      {item.active ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>

                <View style={styles.tags}>
                  <View style={styles.tag}>
                    <ShieldCheck size={13} color={Colors.teal} strokeWidth={2.2} />
                    <Text style={[styles.tagText, { color: Colors.teal }]}>NAFDAC {item.nafdacReg}</Text>
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
                    <Boxes size={14} color={low ? Colors.error : Colors.onSurfaceVariant} strokeWidth={2} />
                    <Text style={[styles.stock, { color: low ? Colors.error : Colors.onSurfaceVariant }]}>
                      {item.stock} in stock{low ? ` · low (≤${item.reorderLevel})` : ''}
                    </Text>
                  </View>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="Boxes"
              title="No products listed"
              message="List NAFDAC-registered products to start selling (HL-5)."
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
  infoText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  form: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  pill: { paddingHorizontal: Spacing.sm + 2, paddingVertical: 4, borderRadius: Radius.full },
  pillActive: { backgroundColor: Colors.iconBgTeal },
  pillInactive: { backgroundColor: Colors.surfaceContainerHigh },
  pillText: { ...Typography.labelSm, fontWeight: '700' as const },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagText: { ...Typography.labelSm, fontWeight: '600' as const },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price: { ...Typography.titleMd, fontSize: 16, color: Colors.primary },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stock: { ...Typography.labelMd },
});
