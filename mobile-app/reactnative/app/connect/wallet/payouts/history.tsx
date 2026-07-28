import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Banknote } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import MoneyAmount from '@/features/connect/components/wallet-MoneyAmount';
import { formatKobo } from '@/features/connect/constants/format';
import type { PayoutRequest } from '@/features/connect/wallet/types';
import { usePayoutHistory } from '@/features/connect/wallet/hooks';

// WL-21 — Payout request history.
function statusColor(s: PayoutRequest['status']) {
  if (s === 'paid') return Colors.teal;
  if (s === 'failed') return Colors.error;
  return Colors.gold; // requested / processing
}

export default function PayoutHistory() {
  const { data, isLoading, error, refetch } = usePayoutHistory();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payout history" />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : error ? (
        <StateView kind="error" title="Couldn't load payouts" actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Banknote" title="No payouts yet"
          message="Your withdrawal requests appear here." actionLabel="Request a payout"
          onAction={() => router.replace('/connect/wallet/payouts/request')} />
      ) : (
        <FlatList<PayoutRequest>
          data={data}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.icon}><Banknote size={18} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.payoutMethodMasked}</Text>
                <Text style={styles.sub}>
                  {new Date(item.createdAt).toLocaleDateString('en-NG')} · {item.ref}
                  {item.feeKobo > 0 ? ` · fee ${formatKobo(item.feeKobo)}` : ''}
                </Text>
              </View>
              <View style={styles.right}>
                <MoneyAmount kobo={item.amountKobo} direction="debit" size="sm" />
                <Text style={[styles.status, { color: statusColor(item.status) }]}>{item.status}</Text>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40 },
  sep: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  status: { ...Typography.labelSm, marginTop: 2, textTransform: 'capitalize' },
});
