import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { TriangleAlert, ChevronRight } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';

import { useProviderOrders } from '@/features/health/lab/hooks';
import type { ProviderOrderRow } from '@/features/health/lab/types';
import { relativeTime } from '@/features/health/constants/health.constants';
import LabStatusPill from '@/features/health/lab/components/LabStatusPill';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'incoming', label: 'Incoming' },
  { value: 'in_lab', label: 'In lab' },
  { value: 'done', label: 'Released' },
];

const INCOMING = ['CREATED', 'SCHEDULED', 'SAMPLE_COLLECTED', 'IN_TRANSIT'];
const IN_LAB = ['ACCESSIONED', 'RESULT_READY', 'ESCALATED'];
const DONE = ['RELEASED'];

function groupOf(status: string): string {
  if (INCOMING.includes(status)) return 'incoming';
  if (IN_LAB.includes(status)) return 'in_lab';
  if (DONE.includes(status)) return 'done';
  return 'all';
}

function routeFor(status: string, orderId: string) {
  if (status === 'SAMPLE_COLLECTED' || status === 'IN_TRANSIT') {
    router.push({ pathname: '/health/lab/provider/accessioning', params: { orderId } });
  } else if (status === 'ACCESSIONED') {
    router.push({ pathname: '/health/lab/provider/result-entry', params: { orderId } });
  } else if (status === 'RESULT_READY' || status === 'ESCALATED') {
    router.push({ pathname: '/health/lab/provider/result-release', params: { orderId } });
  }
}

function OrderCard({ row }: { row: ProviderOrderRow }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => routeFor(row.status, row.orderId)}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.patient}>{row.patientName}</Text>
        <View style={styles.headerRight}>
          {row.hasCritical ? (
            <View style={styles.criticalChip}>
              <TriangleAlert size={12} color={Colors.error} />
              <Text style={styles.criticalText}>CRITICAL</Text>
            </View>
          ) : null}
          <LabStatusPill status={row.status} />
        </View>
      </View>
      <Text style={styles.summary}>{row.testSummary}</Text>
      {row.sampleBarcode ? <Text style={styles.barcode}>#{row.sampleBarcode}</Text> : null}
      <View style={styles.cardFooter}>
        <Text style={styles.time}>{relativeTime(row.createdAt)}</Text>
        <ChevronRight size={18} color={Colors.onSurfaceVariant} />
      </View>
    </Pressable>
  );
}

export default function LabProviderOrdersScreen() {
  const orders = useProviderOrders();
  const [filter, setFilter] = useState('all');

  const rows = orders.data ?? [];
  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => groupOf(r.status) === filter);
  }, [rows, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Orders" subtitle="Samples queue" />
      <View style={styles.filterWrap}>
        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} scrollable />
      </View>

      {orders.isLoading ? (
        <StateView kind="loading" />
      ) : orders.isError ? (
        <StateView
          kind="error"
          title="Couldn't load orders"
          message="Please try again."
          actionLabel="Retry"
          onAction={() => orders.refetch()}
        />
      ) : filtered.length === 0 ? (
        <StateView
          kind="empty"
          icon="ClipboardList"
          title="No orders here"
          message="Orders matching this filter will appear here."
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.orderId}
          renderItem={({ item }) => <OrderCard row={item} />}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterWrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...shadow1,
  },
  cardPressed: { opacity: 0.7 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  patient: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  criticalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.errorContainer,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  criticalText: { ...Typography.labelSm, color: Colors.error },
  summary: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  barcode: { ...Typography.caption, color: Colors.onSurfaceVariant, fontFamily: 'monospace' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
