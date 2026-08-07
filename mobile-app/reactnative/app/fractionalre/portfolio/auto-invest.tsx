import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pause, Repeat } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import { useAutoInvest, useCreateAutoInvest, usePauseAutoInvest } from '@/features/fractionalre/hooks';
import { makeIdempotencyKey, formatNaira, relativeDate } from '@/features/fractionalre/utils';
import { sanitizeMoneyInput } from '@/utils/money';
import { RISK_BAND_LABEL } from '@/features/fractionalre/constants';
import type { RiskBand } from '@/features/fractionalre/types';

export default function AutoInvestScreen() {
  const plans = useAutoInvest();
  const create = useCreateAutoInvest();
  const pause = usePauseAutoInvest();

  const [naira, setNaira] = useState('');
  const [freq, setFreq] = useState<'weekly' | 'monthly'>('monthly');
  const [risk, setRisk] = useState<RiskBand>('balanced');

  const amountKobo = Math.round((parseFloat(naira) || 0) * 100);
  const canCreate = amountKobo > 0 && !create.isPending;

  const onCreate = async () => {
    try {
      await create.mutateAsync({
        input: { amountKobo, frequency: freq, riskBand: risk, kinds: ['income_property', 'development_debt', 'land'] },
        idempotencyKey: makeIdempotencyKey('fre-auto'),
      });
      setNaira('');
      Alert.alert('Auto-invest set up', 'Each run re-checks your investment limit before subscribing.');
    } catch {
      Alert.alert('Could not set up auto-invest', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Auto-invest" subtitle="Invest automatically on a schedule" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Existing plans */}
        {plans.isLoading ? (
          <StateView kind="loading" compact message="Loading…" />
        ) : (plans.data ?? []).map((p) => (
          <View key={p.id} style={styles.planCard}>
            <View style={styles.planHead}>
              <View style={styles.planIcon}><Repeat size={18} color={Colors.primary} strokeWidth={2} /></View>
              <View style={styles.planText}>
                <Text style={styles.planTitle}>{formatNaira(p.amountKobo)} · {p.frequency}</Text>
                <Text style={styles.planSub}>{RISK_BAND_LABEL[p.riskBand]} · next {relativeDate(p.nextRunAt)} · {p.status}</Text>
              </View>
              {p.status === 'active' ? (
                <Pressable hitSlop={8} onPress={() => pause.mutate(p.id)} style={styles.pauseBtn}>
                  <Pause size={16} color={Colors.onWarning} strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}

        {/* Create form */}
        <Text style={styles.section}>New auto-invest</Text>
        <View style={styles.amountBox}>
          <Text style={styles.currency}>₦</Text>
          <TextInput value={naira} onChangeText={(t) => setNaira(sanitizeMoneyInput(t))} keyboardType="decimal-pad" maxLength={13} style={styles.amountInput} placeholder="Amount per run" placeholderTextColor={Colors.onSurfaceVariant} />
        </View>

        <Text style={styles.label}>Frequency</Text>
        <SegmentedControl options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} value={freq} onChange={(v) => setFreq(v as 'weekly' | 'monthly')} />

        <Text style={styles.label}>Risk band</Text>
        <SegmentedControl<RiskBand>
          scrollable
          options={(['conservative', 'balanced', 'growth', 'speculative'] as RiskBand[]).map((b) => ({ value: b, label: RISK_BAND_LABEL[b] }))}
          value={risk} onChange={setRisk}
        />

        <Text style={styles.note}>Each scheduled run re-checks your investment limit before subscribing. Runs are skipped if your allowance is exhausted.</Text>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Set up auto-invest" onPress={onCreate} disabled={!canCreate} loading={create.isPending} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  planCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  planIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  planText: { flex: 1 },
  planTitle: { ...Typography.labelLg, color: Colors.onSurface },
  planSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  pauseBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  amountBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.md },
  currency: { ...Typography.titleLg, color: Colors.onSurface, marginRight: 4 },
  amountInput: { ...Typography.titleLg, color: Colors.onSurface, flex: 1, paddingVertical: Spacing.md },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 16 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
