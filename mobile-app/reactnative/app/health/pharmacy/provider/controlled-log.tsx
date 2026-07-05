import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Lock, CircleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useControlledLog } from '@/features/health/pharmacy/hooks';
import { formatDate, relativeTime } from '@/features/health/constants/health.constants';
import type { ControlledLogEntry } from '@/features/health/pharmacy/types';

const HL4_BANNER =
  'Controlled substances are excluded at MVP. Every controlled dispense is recorded in an immutable statutory register (HL-4).';

export default function ControlledLogScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useControlledLog();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Controlled register" subtitle="Statutory dispense log" />

      {isLoading ? (
        <StateView kind="loading" message="Loading register…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load register" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListHeaderComponent={
            <View style={styles.banner}>
              <CircleAlert size={16} color={Colors.onWarning} strokeWidth={2} />
              <Text style={styles.bannerText}>{HL4_BANNER}</Text>
            </View>
          }
          renderItem={({ item }: { item: ControlledLogEntry }) => (
            <View style={[styles.card, shadow1]}>
              <View style={styles.head}>
                <View style={[styles.icon, { backgroundColor: Colors.iconBgGold }]}>
                  <Lock size={16} color={Colors.onWarning} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.drug} numberOfLines={1}>{item.drugName}</Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {item.patientName} · {item.quantity}
                  </Text>
                </View>
                <Text style={styles.time}>{relativeTime(item.at)}</Text>
              </View>

              <View style={styles.metaRow}>
                <View style={styles.metaCol}>
                  <Text style={styles.metaLabel}>Pharmacist</Text>
                  <Text style={styles.metaValue} numberOfLines={1}>{item.pharmacistName}</Text>
                </View>
                <View style={styles.metaCol}>
                  <Text style={styles.metaLabel}>Register ref</Text>
                  <Text style={styles.registerRef} numberOfLines={1}>{item.registerRef}</Text>
                </View>
              </View>

              <Text style={styles.dispensedAt}>Dispensed {formatDate(item.at)}</Text>
            </View>
          )}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="Lock"
              title="No controlled dispenses recorded"
              message="Controlled-substance dispenses will appear in this immutable register (HL-4)."
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
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  bannerText: { ...Typography.bodySm, color: Colors.onWarning, flex: 1, lineHeight: 18 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 34, height: 34, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  drug: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  time: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', gap: Spacing.md },
  metaCol: { flex: 1 },
  metaLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaValue: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 1 },
  registerRef: {
    ...Typography.bodyMd,
    color: Colors.onSurface,
    marginTop: 1,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  dispensedAt: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
