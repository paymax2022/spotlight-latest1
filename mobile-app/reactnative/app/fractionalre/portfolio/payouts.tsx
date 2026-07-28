import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Coins } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { usePayouts } from '@/features/fractionalre/hooks';
import { formatNaira, relativeDate } from '@/features/fractionalre/utils';

const STATUS_COLOR: Record<string, string> = {
  paid: Colors.teal, scheduled: Colors.secondary, processing: Colors.onWarning,
};

export default function PayoutsScreen() {
  const payouts = usePayouts();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payouts" />
      {payouts.isLoading ? (
        <StateView kind="loading" message="Loading payouts…" />
      ) : (payouts.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No payouts yet" message="Income distributions will appear here." icon="Coins" />
      ) : (
        <FlatList
          data={payouts.data}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.iconBox}><Coins size={18} color={Colors.teal} strokeWidth={2} /></View>
              <View style={styles.text}>
                <Text style={styles.title} numberOfLines={1}>{item.offeringTitle}</Text>
                <Text style={styles.sub}>
                  {item.kind} · {item.status === 'paid' ? `paid ${relativeDate(item.paidAt)}` : `due ${relativeDate(item.dueAt)}`}
                </Text>
              </View>
              <View style={styles.right}>
                <Text style={styles.amount}>{formatNaira(item.amountKobo)}</Text>
                <Text style={[styles.status, { color: STATUS_COLOR[item.status] }]}>{item.status}</Text>
              </View>
            </View>
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  right: { alignItems: 'flex-end' },
  amount: { ...Typography.labelLg, color: Colors.onSurface },
  status: { ...Typography.labelSm, fontWeight: '600', textTransform: 'capitalize' },
});
