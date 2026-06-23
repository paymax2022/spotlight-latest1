import React from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Bell, BellOff, Trash2, TrendingUp, TrendingDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useRateAlerts, useDeleteRateAlert } from '@/features/fx/hooks/useFx';
import { relativeTime } from '@/features/fx/utils/fxFormatters';

export default function RateAlertsScreen() {
  const { data, isLoading, isError, refetch } = useRateAlerts();
  const del = useDeleteRateAlert();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Rate alerts"
        rightSlot={
          <Pressable onPress={() => router.push('/fx/rate-alerts/new')} hitSlop={8} accessibilityRole="button" accessibilityLabel="New alert">
            <Plus size={22} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading alerts…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load alerts" actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView
          kind="empty" icon="Bell" title="No rate alerts"
          message="Get notified when a currency hits your target rate."
          actionLabel="Create alert" onAction={() => router.push('/fx/rate-alerts/new')}
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const above = item.direction === 'above';
            const triggered = !!item.triggeredAt;
            return (
              <View style={styles.card}>
                <View style={[styles.icon, triggered ? styles.iconTriggered : styles.iconActive]}>
                  {!item.active ? <BellOff size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    : above ? <TrendingUp size={18} color={Colors.teal} strokeWidth={2} />
                    : <TrendingDown size={18} color={Colors.secondary} strokeWidth={2} />}
                </View>
                <View style={styles.flex}>
                  <Text style={styles.pair}>{item.from} → {item.to}</Text>
                  <Text style={styles.cond}>
                    Notify when {above ? 'above' : 'below'} {item.target.toLocaleString('en-NG', { maximumFractionDigits: 2 })}
                  </Text>
                  <Text style={styles.meta}>
                    {triggered ? `Triggered ${relativeTime(item.triggeredAt!)}` : item.active ? 'Active' : 'Paused'} · created {relativeTime(item.createdAt)}
                  </Text>
                </View>
                <Pressable onPress={() => del.mutate(item.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete alert">
                  <Trash2 size={18} color={Colors.error} strokeWidth={2} />
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  flex: { flex: 1 },
  icon: { width: 42, height: 42, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  iconActive: { backgroundColor: Colors.iconBgTeal },
  iconTriggered: { backgroundColor: Colors.surfaceContainerHigh },
  pair: { ...Typography.labelLg, color: Colors.onSurface },
  cond: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 1 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
