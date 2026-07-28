import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Wallet, ArrowDownCircle, ArrowUpCircle, Plus } from 'lucide-react-native';
import { getWallet } from '@/api/wallet.api';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useTrips } from '@/features/stays/trips';
import { formatNaira, formatShortDate, StaysColors } from '@/features/stays/constants/stays.constants';

/** Stays-context wallet overview (PRD §17 G, screen 53). Reuses the app wallet. */
export default function WalletOverviewScreen() {
  const wallet = useQuery({ queryKey: ['wallet', 'balance'], queryFn: getWallet, staleTime: 15_000 });
  const trips = useTrips();

  // Stays-scoped ledger view derived from bookings (charges / refunds).
  const lines = (trips.data ?? []).map((t) => {
    const credit = t.bucket === 'cancelled';
    return {
      id: t.id,
      label: credit ? `Refund · ${t.propertyName}` : `Booking · ${t.propertyName}`,
      date: t.createdAt.slice(0, 10),
      amountKobo: t.totalKobo,
      credit,
    };
  });

  const balanceKobo = Math.round((wallet.data?.balance ?? 0) * 100);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Wallet" subtitle="Stays payments & refunds" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.balanceCard}>
          <View style={styles.balanceHead}>
            <Wallet size={20} color={Colors.onPrimary} />
            <Text style={styles.balanceLabel}>Paymax wallet balance</Text>
          </View>
          {wallet.isLoading ? (
            <Text style={styles.balance}>—</Text>
          ) : (
            <Text style={styles.balance}>{formatNaira(balanceKobo)}</Text>
          )}
          <Text style={styles.balanceNote}>Refunds settle here instantly. All stays charges are in Naira.</Text>
        </View>

        <View style={styles.actionRow}>
          <PrimaryButton label="Top up" onPress={() => router.push('/wallet' as never)} style={styles.flexBtn} />
          <PrimaryButton label="Browse stays" variant="secondary" onPress={() => router.replace('/stays')} style={styles.flexBtn} />
        </View>

        <Text style={styles.section}>Stays activity</Text>
        {trips.isLoading ? (
          <StateView kind="loading" compact message="Loading activity…" />
        ) : trips.isError ? (
          <StateView kind="error" compact title="Couldn't load activity" actionLabel="Retry" onAction={() => trips.refetch()} />
        ) : lines.length === 0 ? (
          <StateView kind="empty" compact icon="ReceiptText" title="No stays activity yet" message="Your booking charges and refunds appear here." />
        ) : (
          <View style={styles.ledger}>
            {lines.map((l) => (
              <View key={l.id} style={styles.row}>
                <View style={[styles.rowIcon, { backgroundColor: l.credit ? Colors.iconBgTeal : Colors.iconBgPurple }]}>
                  {l.credit ? <ArrowDownCircle size={18} color={StaysColors.ok} /> : <ArrowUpCircle size={18} color={Colors.primary} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{l.label}</Text>
                  <Text style={styles.rowDate}>{formatShortDate(l.date)}</Text>
                </View>
                <Text style={[styles.rowAmount, l.credit && { color: Colors.teal }]}>
                  {l.credit ? '+' : '-'}{formatNaira(l.amountKobo)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  balanceCard: { backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.lg, gap: 4 },
  balanceHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  balanceLabel: { ...Typography.labelMd, color: Colors.onPrimary },
  balance: { ...Typography.headlineMd, color: Colors.onPrimary, fontWeight: '800' as const },
  balanceNote: { ...Typography.caption, color: Colors.inversePrimary },
  actionRow: { flexDirection: 'row', gap: Spacing.sm },
  flexBtn: { flex: 1 },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  ledger: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const },
  rowDate: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowAmount: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
});
