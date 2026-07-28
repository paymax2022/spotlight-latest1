import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, Wallet, Clock, Hourglass, CircleAlert, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { EarnStatePill, DisclosureCard } from '@/features/referral/components';
import { ReferralColors, COMPLIANT_EARN_SHORT, EarnStateKey } from '@/features/referral/constants/referral.constants';
import { formatNaira } from '@/features/referral/constants/format';
import { useDashboard } from '@/features/referral/home/hooks';

// M-HOME-03 — Earnings summary card: paid / pending / vesting / clawed-back at a glance.
export default function SummaryScreen() {
  const { data, isLoading, isError, refetch } = useDashboard();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Earnings summary" />
      {isLoading ? (
        <StateView kind="loading" message="Loading summary…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Lifetime earned</Text>
            <Text style={styles.totalValue}>{formatNaira(data.snapshot.lifetimeEarnedKobo)}</Text>
            <Text style={styles.totalSub}>From your friends' real, verified activity</Text>
          </View>

          <Line
            icon={<Wallet size={18} color={ReferralColors.ok} strokeWidth={2} />}
            state="eligible" label="Ready to withdraw" amount={data.snapshot.eligibleKobo}
            onPress={() => router.push('/referral/earnings/withdraw')}
          />
          <Line
            icon={<Hourglass size={18} color={ReferralColors.warn} strokeWidth={2} />}
            state="vesting" label="Vesting (unlocks over time)" amount={data.snapshot.vestingKobo}
            onPress={() => router.push('/referral/earnings/vesting-tracker')}
          />
          <Line
            icon={<Clock size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
            state="pending" label="Pending qualifying action" amount={data.snapshot.pendingKobo}
            onPress={() => router.push('/referral/(tabs)/earnings')}
          />
          <Line
            icon={<TrendingUp size={18} color={Colors.tertiaryContainer} strokeWidth={2} />}
            state="paid" label="Paid to wallet" amount={data.snapshot.paidKobo}
            onPress={() => router.push('/referral/earnings/statement')}
          />
          <Line
            icon={<CircleAlert size={18} color={Colors.error} strokeWidth={2} />}
            state="clawed_back" label="Reversed / clawed back" amount={data.snapshot.clawedBackKobo}
            onPress={() => router.push('/referral/earnings/clawback-notice')}
          />

          <DisclosureCard tone="info" title="What these mean" body={COMPLIANT_EARN_SHORT} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Line({ icon, state, label, amount, onPress }: { icon: React.ReactNode; state: EarnStateKey; label: string; amount: number; onPress: () => void }) {
  return (
    <Pressable style={styles.line} onPress={onPress} accessibilityRole="button">
      <View style={styles.lineIcon}>{icon}</View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.lineLabel}>{label}</Text>
        <EarnStatePill state={state} />
      </View>
      <Text style={styles.lineAmount}>{formatNaira(amount)}</Text>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.sm },
  totalCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: 2, marginBottom: Spacing.sm },
  totalLabel: { ...Typography.labelMd, color: Colors.onPrimary, opacity: 0.85 },
  totalValue: { ...Typography.displayLg, color: Colors.onPrimary, fontWeight: '800' as const },
  totalSub: { ...Typography.bodySm, color: Colors.onPrimary, opacity: 0.8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  lineIcon: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  lineLabel: { ...Typography.labelMd, color: Colors.onSurface },
  lineAmount: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
});
