import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { formatNaira } from '@/utils/money';
import { getTransactions } from '@/api/transactions.api';
import type { Transaction, TransactionStatus } from '@/types/transaction';

const LIMIT = 5;

const STATUS_COLOR: Record<TransactionStatus, string> = {
  SUCCESSFUL: '#16A34A',
  FAILED: Colors.error,
  REFUNDED: Colors.teal,
  REVERSED: Colors.teal,
  PROCESSING: Colors.secondary,
  PENDING: Colors.outline,
};

const SERVICE_ICON: Record<string, string> = {
  AIRTIME: '📱',
  DATA: '📶',
  ELECTRICITY: '⚡',
  CABLE_TV: '📺',
  EDUCATION: '🎓',
};

const SERVICE_LABEL: Record<string, string> = {
  AIRTIME: 'Airtime',
  DATA: 'Data',
  ELECTRICITY: 'Electricity',
  CABLE_TV: 'Cable TV',
  EDUCATION: 'Education',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Row({ tx }: { tx: Transaction }) {
  const credit = tx.status === 'REFUNDED' || tx.status === 'REVERSED';
  const title = tx.productName ?? tx.providerName ?? SERVICE_LABEL[tx.serviceType] ?? tx.serviceType;
  return (
    <Pressable
      onPress={() => router.push(`/services/transactions/${tx.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${formatNaira(tx.totalAmount)}, ${tx.status}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.iconBox}><Text style={styles.icon}>{SERVICE_ICON[tx.serviceType] ?? '💳'}</Text></View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {SERVICE_LABEL[tx.serviceType] ?? tx.serviceType} · {fmtDate(tx.createdAt)}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, credit && { color: Colors.teal }]}>
          {credit ? '+' : '-'}{formatNaira(tx.totalAmount)}
        </Text>
        <Text style={[styles.status, { color: STATUS_COLOR[tx.status] ?? Colors.outline }]}>{tx.status}</Text>
      </View>
    </Pressable>
  );
}

export default function RecentUtilityTransactions({
  serviceType,
  heading = 'Recent transactions',
}: {
  /** Limit the list to one service, e.g. 'AIRTIME'. Omit for all services. */
  serviceType?: string;
  heading?: string;
} = {}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['utility-transactions', 'recent', LIMIT, serviceType ?? 'all'],
    queryFn: () => getTransactions({ limit: LIMIT, page: 1, serviceType }),
    staleTime: 30_000,
  });

  // A failed fetch (signed out, offline) shouldn't put an error panel on the hub.
  if (isError) return null;

  const items = data?.items ?? [];

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.heading}>{heading}</Text>
        <Pressable onPress={() => router.push('/services/transactions' as never)} accessibilityRole="link">
          <Text style={styles.action}>See all</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        {isLoading ? (
          <ActivityIndicator color={Colors.secondary} style={styles.loader} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>No bill payments yet. Your latest purchases will show up here.</Text>
        ) : (
          items.map((tx, i) => (
            <View key={tx.id} style={i > 0 ? styles.divider : undefined}>
              <Row tx={tx} />
            </View>
          ))
        )}
        {!isLoading && items.length > 0 && (
          <Pressable onPress={() => router.push('/services/transactions' as never)} style={styles.footer} accessibilityRole="link">
            <Text style={styles.footerText}>View full history</Text>
            <ChevronRight size={16} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.containerMargin,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { ...Typography.titleLg, color: Colors.onSurface },
  action: { ...Typography.labelMd, color: Colors.secondary },
  card: {
    marginHorizontal: Spacing.containerMargin,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 20 },
  info: { flex: 1, gap: 2 },
  title: { ...Typography.labelMd, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end', gap: 2 },
  amount: { ...Typography.labelMd, color: Colors.onSurface },
  status: { ...Typography.labelSm },
  loader: { paddingVertical: Spacing.lg },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.lg },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerHigh,
  },
  footerText: { ...Typography.labelMd, color: Colors.secondary },
});
