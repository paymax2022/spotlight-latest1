import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Pill, ScrollText, RefreshCw, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useMedications } from '@/features/health/pharmacy/hooks';

export default function MedicationListScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useMedications();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="My medications"
        subtitle="Adherence & supply"
        rightSlot={
          <Pressable onPress={() => router.push('/health/pharmacy/refills')} hitSlop={8} accessibilityLabel="Refills">
            <RefreshCw size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading medications…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const low = item.daysLeft <= 7;
            return (
              <View style={[styles.card, shadow1]}>
                <View style={styles.head}>
                  <View style={[styles.icon, { backgroundColor: Colors.iconBgBlue }]}>
                    <Pill size={20} color={Colors.secondary} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>
                      {item.name} {item.form}
                    </Text>
                    <Text style={styles.schedule}>{item.schedule}</Text>
                  </View>
                  {item.rxRequired ? (
                    <View style={styles.rxTag}>
                      <ScrollText size={11} color={Colors.secondary} strokeWidth={2.2} />
                      <Text style={styles.rxTagText}>Rx</Text>
                    </View>
                  ) : null}
                </View>

                {/* Adherence */}
                <View style={styles.adhRow}>
                  <TrendingUp size={13} color={Colors.teal} strokeWidth={2} />
                  <Text style={styles.adhLabel}>Adherence</Text>
                  <Text style={styles.adhValue}>{item.adherence}%</Text>
                </View>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${item.adherence}%` }]} />
                </View>

                {/* Supply */}
                <View style={styles.footerRow}>
                  <Text style={[styles.supply, low && styles.supplyLow]}>
                    {item.daysLeft} day{item.daysLeft === 1 ? '' : 's'} of supply left
                  </Text>
                  <Pressable
                    style={styles.refillBtn}
                    onPress={() =>
                      item.productId
                        ? router.push({ pathname: '/health/pharmacy/product/[id]', params: { id: item.productId } })
                        : router.push('/health/pharmacy/refills')
                    }
                  >
                    <Text style={styles.refillText}>Reorder</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="Pill"
              title="No medications yet"
              message="Medicines from your verified prescriptions appear here."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100, flexGrow: 1 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  schedule: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rxTag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  rxTagText: { ...Typography.caption, color: Colors.secondary, fontWeight: '700' as const },
  adhRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  adhLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  adhValue: { ...Typography.labelMd, color: Colors.onSurface },
  bar: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: Colors.teal },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  supply: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  supplyLow: { color: Colors.error },
  refillBtn: {
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  refillText: { ...Typography.labelMd, color: Colors.secondary },
});
