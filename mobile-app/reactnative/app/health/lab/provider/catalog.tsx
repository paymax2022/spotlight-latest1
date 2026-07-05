import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Clock } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';

import { useProviderCatalog } from '@/features/health/lab/hooks';
import type { CatalogPriceItem } from '@/features/health/lab/types';
import { formatNaira } from '@/features/health/constants/health.constants';

function CatalogRow({ item }: { item: CatalogPriceItem }) {
  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        <View style={styles.rowInfo}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.code}>{item.code}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: item.active ? Colors.tertiaryContainer : Colors.surfaceContainerHigh }]}>
          <Text style={[styles.pillText, { color: item.active ? Colors.teal : Colors.onSurfaceVariant }]}>
            {item.active ? 'Active' : 'Inactive'}
          </Text>
        </View>
      </View>
      <View style={styles.rowBottom}>
        <View style={styles.tatChip}>
          <Clock size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.tatText}>{item.tat}</Text>
        </View>
        <Text style={styles.price}>{formatNaira(item.priceKobo)}</Text>
      </View>
    </View>
  );
}

export default function LabProviderCatalogScreen() {
  const catalog = useProviderCatalog();

  if (catalog.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Test catalog" subtitle="Pricing & availability" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (catalog.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Test catalog" subtitle="Pricing & availability" />
        <StateView
          kind="error"
          title="Couldn't load catalog"
          message="Please try again."
          actionLabel="Retry"
          onAction={() => catalog.refetch()}
        />
      </SafeAreaView>
    );
  }

  const items = catalog.data ?? [];

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Test catalog" subtitle="Pricing & availability" />
        <StateView
          kind="empty"
          icon="TestTube"
          title="No tests yet"
          message="Tests you offer will appear here with their prices and turnaround times."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Test catalog" subtitle="Pricing & availability" />
      <FlatList
        data={items}
        keyExtractor={(it) => it.testId}
        renderItem={({ item }) => <CatalogRow item={item} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={styles.headerNote}>
            Prices and availability for each test are managed here. Patients see live pricing when booking.
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  headerNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...shadow1,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.sm },
  rowInfo: { flex: 1, gap: 2 },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  code: { ...Typography.caption, color: Colors.onSurfaceVariant },
  pill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  pillText: { ...Typography.labelSm },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surfaceContainerLow,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  tatText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  price: { ...Typography.titleMd, color: Colors.onSurface },
});
