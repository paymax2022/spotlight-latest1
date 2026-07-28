import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function BudgetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Use of funds" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load budget" actionLabel="Retry" onAction={refetch} />
      ) : c.budget.length === 0 ? (
        <StateView kind="empty" icon="Wallet" title="No budget breakdown" message="The creator hasn't added a budget breakdown for this campaign." />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>How {formatNaira(c.goalKobo)} will be spent</Text>
          {c.budget.map((item) => {
            const pct = c.goalKobo > 0 ? Math.round((item.amountKobo / c.goalKobo) * 100) : 0;
            return (
              <View key={item.id} style={styles.row}>
                <View style={styles.rowHead}>
                  <Text style={styles.label}>{item.label}</Text>
                  <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
                </View>
                {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
                <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
                <Text style={styles.pct}>{pct}% of goal</Text>
              </View>
            );
          })}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total goal</Text>
            <Text style={styles.totalValue}>{formatNaira(c.goalKobo)}</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  row: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 6 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  amount: { ...Typography.labelLg, color: Colors.onSurface },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  track: { height: 6, borderRadius: 9999, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden', marginTop: 4 },
  fill: { height: '100%', borderRadius: 9999, backgroundColor: Colors.secondary },
  pct: { ...Typography.caption, color: Colors.onSurfaceVariant },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalValue: { ...Typography.titleMd, color: Colors.primary },
});
