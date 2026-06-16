import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Platform, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getTransactions } from '@/api/transactions.api';
import { Transaction, ServiceType, TransactionStatus } from '@/types/transaction';

const SERVICE_FILTERS: Array<{ label: string; value: string }> = [
  { label: 'All', value: '' },
  { label: 'Airtime', value: 'AIRTIME' },
  { label: 'Data', value: 'DATA' },
  { label: 'Electricity', value: 'ELECTRICITY' },
  { label: 'Cable TV', value: 'CABLE_TV' },
  { label: 'Education', value: 'EDUCATION' },
];

const STATUS_COLOR: Record<TransactionStatus, string> = {
  SUCCESSFUL: '#16A34A',
  FAILED:     Colors.error,
  REFUNDED:   Colors.teal,
  REVERSED:   Colors.teal,
  PROCESSING: Colors.secondary,
  PENDING:    Colors.outline,
};

const SERVICE_ICON: Record<string, string> = {
  AIRTIME:     '📱',
  DATA:        '📶',
  ELECTRICITY: '⚡',
  CABLE_TV:    '📺',
  EDUCATION:   '🎓',
};

function TxCard({ tx, onPress }: { tx: Transaction; onPress: () => void }) {
  const isDebit  = tx.status !== 'REFUNDED' && tx.status !== 'REVERSED';
  const statusClr = STATUS_COLOR[tx.status] ?? Colors.outline;
  const icon     = SERVICE_ICON[tx.serviceType] ?? '💳';
  return (
    <Pressable onPress={onPress} style={styles.txCard}>
      <View style={styles.txIconBox}><Text style={{ fontSize: 22 }}>{icon}</Text></View>
      <View style={styles.txInfo}>
        <Text style={styles.txTitle} numberOfLines={1}>{tx.productName ?? tx.providerName ?? tx.serviceType}</Text>
        <Text style={styles.txSub} numberOfLines={1}>{tx.customerIdentifier}</Text>
        <Text style={[styles.txStatus, { color: statusClr }]}>{tx.status}</Text>
      </View>
      <View style={styles.txRight}>
        <Text style={[styles.txAmount, { color: isDebit ? Colors.onSurface : Colors.teal }]}>
          {isDebit ? '-' : '+'}₦{tx.totalAmount.toLocaleString()}
        </Text>
        <Text style={styles.txDate}>{new Date(tx.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</Text>
      </View>
    </Pressable>
  );
}

export default function TransactionsScreen() {
  const [serviceFilter, setServiceFilter] = useState('');

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['transactions', serviceFilter],
    queryFn:  () => getTransactions({ serviceType: serviceFilter || undefined, limit: 50 }),
  });

  const items = data?.items ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.topTitle}>Transactions</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        {/* Service filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {SERVICE_FILTERS.map((f) => (
            <Pressable
              key={f.value}
              testID={f.value ? `filter-pill-${f.value}` : 'filter-pill-all'}
              onPress={() => setServiceFilter(f.value)}
              style={[styles.filterPill, serviceFilter === f.value && styles.filterPillActive]}
            >
              <Text style={[styles.filterText, serviceFilter === f.value && styles.filterTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {isLoading ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : isError ? (
          <View style={styles.msgBox}>
            <Text style={styles.errorText}>Could not load transactions. Pull down to retry.</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.msgBox}>
            <Text style={styles.emptyText}>No transactions found.</Text>
          </View>
        ) : (
          <View style={[styles.list, shadow1]}>
            {items.map((tx, i) => (
              <View key={tx.id}>
                <TxCard tx={tx} onPress={() => router.push(`/services/transactions/${tx.id}` as never)} />
                {i < items.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  topBar:     { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(248,249,255,0.92)', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconBtn:    { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle:   { ...Typography.titleLg, color: Colors.primary },
  content:    { paddingBottom: Platform.OS === 'ios' ? 100 : 80 },
  filterRow:  { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  filterPill: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  filterPillActive:{ backgroundColor: Colors.primaryContainer, borderColor: Colors.primaryContainer },
  filterText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  filterTextActive:{ color: Colors.onPrimaryContainer },
  list:       { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, marginHorizontal: Spacing.containerMargin, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  txCard:     { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, gap: Spacing.sm },
  txIconBox:  { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  txInfo:     { flex: 1 },
  txTitle:    { ...Typography.labelMd, color: Colors.onSurface },
  txSub:      { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  txStatus:   { ...Typography.caption, marginTop: 2, fontWeight: '600' },
  txRight:    { alignItems: 'flex-end' },
  txAmount:   { ...Typography.labelMd, fontWeight: '700' },
  txDate:     { ...Typography.caption, color: Colors.outline, marginTop: 2 },
  divider:    { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  msgBox:     { alignItems: 'center', paddingTop: Spacing.xl, paddingHorizontal: Spacing.containerMargin },
  emptyText:  { ...Typography.bodyMd, color: Colors.outline, textAlign: 'center' },
  errorText:  { ...Typography.bodyMd, color: Colors.error, textAlign: 'center' },
});
