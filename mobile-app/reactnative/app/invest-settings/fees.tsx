import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useFeeSchedule } from '@/features/investsettings/hooks/useSettings';

export default function FeesScreen() {
  const { data, isLoading, isError, refetch } = useFeeSchedule();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Fee schedule" subtitle="What we charge, plainly" />

      {isLoading ? (
        <StateView kind="loading" message="Loading fees…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load fees" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.group}>
            {data.map((item, i) => (
              <View key={item.label} style={[styles.row, i < data.length - 1 && styles.rowBorder]}>
                <Text style={styles.label}>{item.label}</Text>
                <Text style={styles.value}>{item.value}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>
            Fees are illustrative and may vary by asset and KYC tier. Network fees for crypto
            withdrawals are passed through at cost.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  group: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: Spacing.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.md,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerLow },
  label: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  value: { ...Typography.labelLg, color: Colors.onSurface },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.md },
});
