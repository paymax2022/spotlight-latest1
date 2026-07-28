import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Minus, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import CurrencyChip from '@/features/fx/components/CurrencyChip';
import { useThresholds, useUpdateThreshold } from '@/features/fx/hooks/useFxAccount';
import { parseToMinor, minorToInput } from '@/features/fx/utils/fxFormatters';

export default function ThresholdsScreen() {
  const { data, isLoading, isError, refetch } = useThresholds();
  const update = useUpdateThreshold();
  const [local, setLocal] = useState<Record<string, { amount: string; approvers: number }>>({});

  useEffect(() => {
    if (data) {
      const init: Record<string, { amount: string; approvers: number }> = {};
      data.forEach((t) => { init[t.id] = { amount: minorToInput(t.amount, t.currency), approvers: t.approversRequired }; });
      setLocal(init);
    }
  }, [data]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Approval thresholds" subtitle="Amounts above which approval is required" />
      {isLoading ? <StateView kind="loading" /> : isError ? <StateView kind="error" title="Couldn't load thresholds" actionLabel="Retry" onAction={() => refetch()} /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {(data ?? []).map((t) => {
            const l = local[t.id] ?? { amount: '', approvers: t.approversRequired };
            const set = (patch: Partial<{ amount: string; approvers: number }>) => setLocal((p) => ({ ...p, [t.id]: { ...l, ...patch } }));
            return (
              <View key={t.id} style={styles.card}>
                <Text style={styles.label}>{t.label}</Text>
                <View style={styles.amountRow}>
                  <CurrencyChip currency={t.currency} compact />
                  <TextInput style={styles.amountInput} value={l.amount} onChangeText={(v) => set({ amount: v })} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={Colors.outline} accessibilityLabel={`${t.label} threshold amount`} />
                </View>
                <View style={styles.approversRow}>
                  <Text style={styles.approversLabel}>Approvers required</Text>
                  <View style={styles.stepper}>
                    <Pressable onPress={() => set({ approvers: Math.max(1, l.approvers - 1) })} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Decrease approvers"><Minus size={16} color={Colors.onSurface} strokeWidth={2} /></Pressable>
                    <Text style={styles.stepValue}>{l.approvers}</Text>
                    <Pressable onPress={() => set({ approvers: Math.min(5, l.approvers + 1) })} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Increase approvers"><Plus size={16} color={Colors.onSurface} strokeWidth={2} /></Pressable>
                  </View>
                </View>
                <PrimaryButton
                  label="Save"
                  variant="secondary"
                  onPress={() => update.mutate({ id: t.id, amount: parseToMinor(l.amount, t.currency), approversRequired: l.approvers })}
                  loading={update.isPending}
                />
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, height: 56 },
  amountInput: { flex: 1, textAlign: 'right', ...Typography.titleMd, color: Colors.onSurface, padding: 0 },
  approversRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  approversLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  stepValue: { ...Typography.titleMd, color: Colors.onSurface, minWidth: 20, textAlign: 'center' },
});
