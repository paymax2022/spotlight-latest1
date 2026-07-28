import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowUpCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useTierLimits } from '@/features/fx/hooks/useFxAccount';
import { formatMoney } from '@/features/fx/utils/fxFormatters';
import type { TierLimits } from '@/features/fx/types/fx.types';

export default function LimitsScreen() {
  const { data, isLoading, isError, refetch } = useTierLimits();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Limits & tier" />
      {isLoading ? <StateView kind="loading" /> : isError || !data ? <StateView kind="error" title="Couldn't load limits" actionLabel="Retry" onAction={() => refetch()} /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.tierCard}>
            <Text style={styles.tierLabel}>Your tier</Text>
            <Text style={styles.tier}>{data.tierLabel}</Text>
          </View>

          <LimitBar label="Daily conversion" used={data.dailyConvertUsedMinor} limit={data.dailyConvertLimitMinor} currency={data.currency} />
          <LimitBar label="Monthly payouts" used={data.monthlyPayoutUsedMinor} limit={data.monthlyPayoutLimitMinor} currency={data.currency} />

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Per-transaction limit</Text>
            <Text style={styles.rowValue}>{formatMoney(data.perTxLimitMinor, data.currency)}</Text>
          </View>

          <View style={styles.upsell}>
            <ArrowUpCircle size={20} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.upsellText}>Upgrade your tier to raise these limits. Higher tiers require additional verification.</Text>
          </View>
        </ScrollView>
      )}

      {data ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Upgrade tier" onPress={() => router.push('/fx/kyc')} />
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

function LimitBar({ label, used, limit, currency }: { label: string; used: number; limit: number; currency: TierLimits['currency'] }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const color = pct >= 90 ? Colors.error : pct >= 70 ? Colors.gold : Colors.teal;
  return (
    <View style={styles.limitCard}>
      <View style={styles.limitHead}>
        <Text style={styles.limitLabel}>{label}</Text>
        <Text style={styles.limitValue}>{formatMoney(used, currency)} / {formatMoney(limit, currency)}</Text>
      </View>
      <View style={styles.track}><View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  tierCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  tierLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  tier: { ...Typography.titleLg, color: Colors.primary, marginTop: 2 },
  limitCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  limitHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  limitLabel: { ...Typography.labelLg, color: Colors.onSurface },
  limitValue: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  track: { height: 8, borderRadius: 4, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface },
  upsell: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.iconBgPurple, borderRadius: Radius.md, padding: Spacing.md },
  upsellText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
