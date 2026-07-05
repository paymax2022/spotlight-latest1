import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import VendorChargeRow from '@/features/events/components/VendorChargeRow';
import { useEvent, useEventWallet, useWalletEntries } from '@/features/events/hooks';
import { EventColors, formatNaira } from '@/features/events/constants/events.constants';

export default function WalletHistory() {
  const params = useLocalSearchParams<{ eventId: string; walletId: string }>();
  const eventId = params.eventId ?? 'e_live';
  const walletId = params.walletId ?? '';
  const { data: event } = useEvent(eventId);
  const { data: wallet, isLoading, isError, refetch } = useEventWallet(walletId);
  const entries = useWalletEntries(walletId);

  const toppedUpKobo = (entries.data ?? []).filter((e) => e.type === 'TOPUP').reduce((s, e) => s + e.amount_kobo, 0);
  const spentKobo = (entries.data ?? []).filter((e) => e.type === 'CHARGE').reduce((s, e) => s + e.amount_kobo, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Spend history" subtitle={event?.title} />
      {isLoading ? (
        <StateView kind="loading" message="Loading history…" />
      ) : isError || !wallet ? (
        <StateView kind="error" title="Couldn't load history" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (entries.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No activity yet" message="Top up and pay vendors to see your spend here." icon="History" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.summary}>
            <Sum label="Topped up" value={formatNaira(toppedUpKobo)} />
            <View style={styles.divider} />
            <Sum label="Spent" value={formatNaira(spentKobo)} />
            <View style={styles.divider} />
            <Sum label="Balance" value={formatNaira(wallet.balance_kobo)} highlight />
          </View>

          <View style={styles.list}>
            {(entries.data ?? []).map((e) => <VendorChargeRow key={e.id} entry={e} />)}
          </View>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Sum({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.sumItem}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={[styles.sumValue, highlight && { color: EventColors.brand }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  summary: { flexDirection: 'row', alignItems: 'center', backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  sumItem: { flex: 1, alignItems: 'center', gap: 2 },
  sumLabel: { ...Typography.caption, color: EventColors.muted },
  sumValue: { ...Typography.labelLg, color: Colors.onSurface },
  divider: { width: 1, height: 32, backgroundColor: Colors.outlineVariant },
  list: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, ...shadow1 },
});
