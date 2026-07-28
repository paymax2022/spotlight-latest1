import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira, formatCountdown } from '@/features/referral/constants/format';
import { useVestingSchedule } from '@/features/referral/earnings/hooks';
import type { VestingTranche } from '@/features/referral/earnings/types';

// M-ERN-03 — Vesting / holdback tracker: what unlocks when, conditions remaining.
const CONDITION_LABEL: Record<string, string> = {
  kyc_completed: 'Completes KYC',
  first_transaction: 'Makes first transaction',
  retained_30d: 'Stays active 30 days',
  retained_60d: 'Stays active 60 days',
  retained_90d: 'Stays active 90 days',
  mission_complete: 'Mission completed',
};

export default function VestingTrackerScreen() {
  const { data, isLoading, isError, refetch } = useVestingSchedule();

  const pct = data && data.totalKobo > 0 ? Math.round((data.unlockedKobo / data.totalKobo) * 100) : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Vesting tracker" />
      {isLoading ? (
        <StateView kind="loading" message="Loading vesting…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : !data || data.tranches.length === 0 ? (
        <StateView kind="empty" icon="Hourglass" title="Nothing vesting" message="When a reward is held to vest over time, its schedule appears here." />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>{data.inviteeName ? `Vesting from ${data.inviteeName}` : 'Vesting reward'}</Text>
            <Text style={styles.summaryValue}>{formatNaira(data.unlockedKobo)} <Text style={styles.summaryTotal}>/ {formatNaira(data.totalKobo)} unlocked</Text></Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
          </View>

          <DisclosureCard
            tone="info"
            title="Why rewards vest"
            body="Rewards release in tranches as your friend proves real value. This protects everyone from fake accounts and incentive farming — and keeps the program honest."
          />

          <Text style={styles.sectionTitle}>Tranches</Text>
          <View style={{ gap: Spacing.sm }}>
            {data.tranches.map((t) => <Tranche key={t.id} t={t} />)}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Tranche({ t }: { t: VestingTranche }) {
  const countdown = t.unlocksAt ? formatCountdown(t.unlocksAt) : null;
  return (
    <View style={[styles.tranche, t.unlocked && styles.trancheUnlocked]}>
      <View style={[styles.trancheIcon, t.unlocked ? styles.iconUnlocked : styles.iconLocked]}>
        {t.unlocked ? <Check size={16} color={Colors.white} strokeWidth={3} /> : <Lock size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.trancheLabel}>{t.label}</Text>
        <Text style={styles.trancheCond}>Unlocks when your friend: {CONDITION_LABEL[t.condition] ?? t.condition}</Text>
        {!t.unlocked && countdown ? <Text style={styles.trancheEta}>Est. {countdown} away</Text> : null}
        {t.unlocked ? <Text style={styles.trancheDone}>Unlocked</Text> : null}
      </View>
      <Text style={styles.trancheAmount}>{formatNaira(t.amountKobo)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  summary: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg, gap: Spacing.sm },
  summaryLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  summaryValue: { ...Typography.headlineMd, color: Colors.onSurface, fontWeight: '800' as const },
  summaryTotal: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, fontWeight: '400' as const },
  progressTrack: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden', marginTop: 4 },
  progressFill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  tranche: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  trancheUnlocked: { borderColor: Colors.primary },
  trancheIcon: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  iconUnlocked: { backgroundColor: Colors.primary },
  iconLocked: { backgroundColor: Colors.surfaceContainerHigh },
  trancheLabel: { ...Typography.labelLg, color: Colors.onSurface },
  trancheCond: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  trancheEta: { ...Typography.caption, color: Colors.onWarning, marginTop: 2 },
  trancheDone: { ...Typography.caption, color: Colors.tertiaryContainer, marginTop: 2 },
  trancheAmount: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
});
