import React from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { usePortfolio } from '@/features/crowdfunding/hooks/useInvestment';
import { formatNaira, formatNairaCompact, relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { PortfolioHolding } from '@/features/crowdfunding/types/investment.types';

const STATUS: Record<PortfolioHolding['status'], { label: string; fg: string; bg: string }> = {
  ACTIVE: { label: 'Active', fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  EXITED: { label: 'Exited', fg: Colors.secondary, bg: Colors.iconBgBlue },
  DEFAULTED: { label: 'Defaulted', fg: Colors.error, bg: Colors.iconBgRed },
};

export default function PortfolioScreen() {
  const { data, isLoading, isError, refetch } = usePortfolio();
  const holdings = data ?? [];
  const invested = holdings.reduce((s, h) => s + h.investedKobo, 0);
  const value = holdings.reduce((s, h) => s + h.currentValueKobo, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My portfolio" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load portfolio" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={holdings}
          keyExtractor={(h) => h.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            holdings.length > 0 ? (
              <View style={styles.summary}>
                <View style={styles.sumCol}><Text style={styles.sumLabel}>Invested</Text><Text style={styles.sumValue}>{formatNairaCompact(invested)}</Text></View>
                <View style={styles.sumDivider} />
                <View style={styles.sumCol}><Text style={styles.sumLabel}>Current value</Text><Text style={[styles.sumValue, { color: Colors.teal }]}>{formatNairaCompact(value)}</Text></View>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const meta = STATUS[item.status];
            return (
              <View style={styles.row}>
                <View style={styles.body}>
                  <Text style={styles.title} numberOfLines={1}>{item.offerTitle}</Text>
                  <Text style={styles.issuer}>{item.issuerName} · {item.model.replace('_', ' ')}</Text>
                  <Text style={styles.time}>Invested {relativeTime(item.investedAt)}</Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.amount}>{formatNaira(item.currentValueKobo)}</Text>
                  <View style={[styles.chip, { backgroundColor: meta.bg }]}><Text style={[styles.chipText, { color: meta.fg }]}>{meta.label}</Text></View>
                </View>
              </View>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <StateView kind="empty" icon="Briefcase" title="No investments yet" message="Browse open offers to build your portfolio." actionLabel="Browse offers" onAction={() => router.replace('/crowdfunding/investment/offers')} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, flexGrow: 1 },
  summary: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, marginBottom: Spacing.md },
  sumCol: { flex: 1 },
  sumLabel: { ...Typography.labelSm, color: Colors.inversePrimary },
  sumValue: { ...Typography.headlineMd, color: Colors.onPrimary, marginTop: 2 },
  sumDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.2)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  body: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  issuer: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  time: { ...Typography.caption, color: Colors.outline },
  right: { alignItems: 'flex-end', gap: 4 },
  amount: { ...Typography.labelLg, color: Colors.onSurface },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { ...Typography.caption, fontWeight: '600' as const },
  sep: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
});
