import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Receipt } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';
import { useStanding } from '@/features/referral/foundation/hooks';
import { formatNaira } from '@/features/referral/constants/format';

// M-ACC-03 — Earnings & tax info. High-earner tax/withholding details.
export default function EarningsTax() {
  const { data, isLoading, isError, refetch } = useStanding();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReferralHeader title="Earnings & tax" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load tax info" actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <View style={styles.cardIcon}><Receipt size={22} color={Colors.secondary} strokeWidth={2} /></View>
            <Text style={styles.lifetimeLabel}>Lifetime earned</Text>
            <Text style={styles.lifetimeValue}>{formatNaira(data.earnedKobo)}</Text>
          </View>

          <View style={styles.rows}>
            <Row label="Withholding applied" value={formatNaira(0)} />
            <Row label="Currently withheld / on hold" value={formatNaira(data.withheldKobo)} />
            <Row label="Tax year" value={String(new Date().getFullYear())} last />
          </View>

          <DisclosureCard
            tone="info"
            title="About tax on earnings"
            body="Referral earnings may be taxable income. High earners may have withholding applied automatically. We provide statements you can use for filing — but this is not tax advice. Consult a professional for your situation."
          />
          <DisclosureCard
            tone="compliant"
            body="All earnings shown reflect rewards from friends’ genuine, verified activity. Amounts are recorded in kobo and reconciled to the ledger."
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.md },
  card: { alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg },
  cardIcon: { width: 48, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  lifetimeLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  lifetimeValue: { ...Typography.headlineMd, color: Colors.onSurface },
  rows: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface },
});
