import React from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, BellOff, Trash2, TrendingUp, TrendingDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import { useAlerts, useDeleteAlert } from '@/features/crypto/hooks/useCrypto';
import { formatFiatObj, relativeTime } from '@/features/crypto/utils/cryptoFormatters';

export default function CryptoAlertsScreen() {
  const { data, isLoading, isError, refetch } = useAlerts();
  const del = useDeleteAlert();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Price alerts"
        subtitle="Get notified on price moves"
        rightSlot={
          <Pressable onPress={() => router.push('/crypto/alerts/new')} hitSlop={8} accessibilityRole="button" accessibilityLabel="New alert">
            <Plus size={22} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading alerts…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load alerts" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView
          kind="empty" icon="Bell" title="No price alerts"
          message="Get a notification when an asset hits your target price."
          actionLabel="Create alert" onAction={() => router.push('/crypto/alerts/new')}
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const above = item.condition === 'above';
            const triggered = !!item.triggeredAt;
            return (
              <View style={styles.card}>
                <AssetIcon symbol={item.symbol} color={item.iconColor} />
                <View style={styles.flex}>
                  <View style={styles.titleRow}>
                    <Text style={styles.symbol}>{item.symbol}</Text>
                    {item.status === 'paused'
                      ? <BellOff size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                      : above
                        ? <TrendingUp size={14} color={Colors.teal} strokeWidth={2} />
                        : <TrendingDown size={14} color={Colors.secondary} strokeWidth={2} />}
                  </View>
                  <Text style={styles.cond}>
                    Notify when {above ? 'above' : 'below'} {formatFiatObj(item.targetPrice)}
                  </Text>
                  <Text style={styles.meta}>
                    {triggered ? `Triggered ${relativeTime(item.triggeredAt!)}` : item.status === 'active' ? 'Active' : 'Paused'} · created {relativeTime(item.createdAt)}
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  symbol: { ...Typography.labelLg, color: Colors.onSurface },
  cond: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 1 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
