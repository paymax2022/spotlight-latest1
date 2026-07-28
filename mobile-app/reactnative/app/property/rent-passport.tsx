import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2, XCircle, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import { useRentPassport } from '@/features/property/hooks';

// Local kobo → ₦ formatter (no shared util exists; amounts are integer minor units).
function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RentPassportScreen() {
  const { data, isLoading, isError, refetch } = useRentPassport();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Rent passport" subtitle="Your portable tenancy record" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <StateView kind="loading" compact message="Loading your passport…" />
        ) : isError || !data ? (
          <StateView
            kind="error"
            title="Couldn't load passport"
            message="Something went wrong. Please try again."
            actionLabel="Retry"
            onAction={() => refetch()}
            compact
          />
        ) : (
          <>
            {/* Score card */}
            <View style={[styles.scoreCard, shadow1]}>
              <View style={styles.scoreIcon}><TrendingUp size={24} color={Colors.teal} strokeWidth={2} /></View>
              <Text style={styles.score}>{data.score}</Text>
              <Text style={styles.scoreLabel}>Rent passport score</Text>
              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{Math.round(data.onTimeRate * 100)}%</Text>
                  <Text style={styles.statLabel}>On-time</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{data.paymentsCount}</Text>
                  <Text style={styles.statLabel}>Payments</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{formatNaira(data.totalPaidKobo)}</Text>
                  <Text style={styles.statLabel}>Total paid</Text>
                </View>
              </View>
            </View>

            <SectionHeader title="Recent payments" style={styles.section} />
            <View style={styles.list}>
              {data.recentPayments.length === 0 ? (
                <StateView kind="empty" icon="ReceiptText" title="No payments yet" message="Your rent payments will appear here." compact />
              ) : (
                data.recentPayments.map((p) => (
                  <View key={p.id} style={styles.payRow}>
                    {p.onTime ? (
                      <CheckCircle2 size={20} color={Colors.teal} strokeWidth={2} />
                    ) : (
                      <XCircle size={20} color={Colors.error} strokeWidth={2} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.payAmount}>{formatNaira(p.amountKobo)}</Text>
                      <Text style={styles.payMeta} numberOfLines={1}>
                        {formatDate(p.paidAt)}{p.propertyName ? ` · ${p.propertyName}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.payTag, p.onTime ? styles.payTagOk : styles.payTagLate]}>
                      {p.onTime ? 'On time' : 'Late'}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  section: { paddingHorizontal: 0, marginTop: Spacing.md },
  scoreCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    marginTop: Spacing.sm,
  },
  scoreIcon: { width: 56, height: 56, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  score: { ...Typography.headlineMd, color: Colors.onSurface },
  scoreLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  statRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: Spacing.md },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { ...Typography.labelLg, color: Colors.onSurface },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  statDivider: { width: 1, height: 32, backgroundColor: Colors.outlineVariant },
  list: { gap: Spacing.sm },
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
  },
  payAmount: { ...Typography.labelLg, color: Colors.onSurface },
  payMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  payTag: { ...Typography.labelSm, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full, overflow: 'hidden' },
  payTagOk: { backgroundColor: Colors.iconBgTeal, color: Colors.teal },
  payTagLate: { backgroundColor: Colors.errorContainer, color: Colors.error },
});
