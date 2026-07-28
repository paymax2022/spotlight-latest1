import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Minus, Plus, AlertTriangle, CheckCircle2, ShieldX } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import { useOffering, useLimitCheck } from '@/features/fractionalre/hooks';
import { useInvestDraft } from '@/features/fractionalre/store/investDraftStore';
import { formatNaira } from '@/features/fractionalre/utils';
import RiskRibbon from '@/features/fractionalre/components/RiskRibbon';

export default function InvestAmountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offering = useOffering(id);
  const limitCheck = useLimitCheck();
  const { draft, patch } = useInvestDraft();

  const [mode, setMode] = useState<'units' | 'amount'>('units');
  const [units, setUnits] = useState(0);
  const [naira, setNaira] = useState('');

  const o = offering.data;
  useEffect(() => {
    if (o && units === 0) setUnits(o.minUnits);
  }, [o]);

  if (offering.isLoading || !o) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Invest" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }

  const amountKobo = mode === 'units'
    ? units * o.unitPriceKobo
    : Math.round((parseFloat(naira) || 0) * 100);
  const effectiveUnits = mode === 'units' ? units : Math.floor(amountKobo / o.unitPriceKobo);
  const platformFeeKobo = Math.round((amountKobo * o.platformFeeBps) / 10_000);
  const totalKobo = amountKobo + platformFeeKobo;
  const belowMin = effectiveUnits < o.minUnits;

  const lc = limitCheck.data;
  const blocked = lc?.status === 'block';

  const runLimitCheck = () => {
    if (amountKobo <= 0) return;
    limitCheck.mutate({ offeringId: o.id, amountKobo });
  };

  // Re-check whenever the amount settles (debounced via effect).
  useEffect(() => {
    if (amountKobo <= 0 || belowMin) return;
    const t = setTimeout(runLimitCheck, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountKobo, belowMin]);

  const canContinue = amountKobo > 0 && !belowMin && !blocked && lc?.status != null && !limitCheck.isPending;

  const onContinue = () => {
    patch({
      offeringId: o.id, mode, units: effectiveUnits, amountKobo,
      unitPriceKobo: o.unitPriceKobo, limitCheck: lc ?? null,
    });
    router.push(`/fractionalre/${o.id}/sign` as never);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Choose amount" subtitle={o.title} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <SegmentedControl
          options={[{ value: 'units', label: 'By units' }, { value: 'amount', label: 'By amount' }]}
          value={mode} onChange={(v) => setMode(v as 'units' | 'amount')}
        />

        {mode === 'units' ? (
          <View style={styles.stepper}>
            <Pressable style={styles.stepBtn} onPress={() => setUnits((u) => Math.max(o.minUnits, u - 1))}>
              <Minus size={20} color={Colors.primary} strokeWidth={2.5} />
            </Pressable>
            <View style={styles.stepperMid}>
              <Text style={styles.unitCount}>{units}</Text>
              <Text style={styles.unitLabel}>units · {formatNaira(o.unitPriceKobo)} each</Text>
            </View>
            <Pressable style={styles.stepBtn} onPress={() => setUnits((u) => u + 1)}>
              <Plus size={20} color={Colors.primary} strokeWidth={2.5} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.amountBox}>
            <Text style={styles.currency}>₦</Text>
            <TextInput
              value={naira}
              onChangeText={(t) => setNaira(t.replace(/[^0-9.]/g, ''))}
              keyboardType="numeric"
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor={Colors.onSurfaceVariant}
            />
          </View>
        )}

        {belowMin ? (
          <Text style={styles.minWarn}>Minimum is {o.minUnits} unit{o.minUnits > 1 ? 's' : ''} ({formatNaira(o.minUnits * o.unitPriceKobo)}).</Text>
        ) : null}

        {/* Inline limit-check status */}
        {!belowMin && amountKobo > 0 ? (
          <View style={styles.limitBox}>
            {limitCheck.isPending ? (
              <View style={styles.limitRow}>
                <ActivityIndicator size="small" color={Colors.secondary} />
                <Text style={styles.limitText}>Checking your investment limit…</Text>
              </View>
            ) : lc ? (
              <View style={[styles.limitRow, blocked && styles.limitBlock, lc.status === 'warn' && styles.limitWarn, lc.status === 'pass' && styles.limitPass]}>
                {blocked ? <ShieldX size={18} color={Colors.error} strokeWidth={2} />
                  : lc.status === 'warn' ? <AlertTriangle size={18} color={Colors.onWarning} strokeWidth={2} />
                  : <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />}
                <View style={styles.limitTextWrap}>
                  <Text style={styles.limitText}>
                    {blocked ? 'Limit exceeded' : lc.status === 'warn' ? 'Close to your limit' : 'Within your limit'}
                  </Text>
                  <Text style={styles.limitSub}>
                    {lc.message ?? `Remaining allowance: ${formatNaira(lc.remainingKobo)}`}
                  </Text>
                  {blocked ? (
                    <Text style={styles.limitExplainer}>
                      Retail investors have an annual subscription cap set by regulation and your suitability profile.
                      Reduce the amount, or upgrade your investor classification in Account.
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Order summary + fees */}
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Order summary</Text>
          <Row label={`${effectiveUnits} unit${effectiveUnits === 1 ? '' : 's'}`} value={formatNaira(amountKobo)} />
          <Row label={`Platform fee (${(o.platformFeeBps / 100).toFixed(2)}%)`} value={formatNaira(platformFeeKobo)} />
          <View style={styles.divider} />
          <Row label="Total" value={formatNaira(totalKobo)} bold />
          <Text style={styles.feeNote}>Final fees are confirmed by the server at execution.</Text>
        </View>

        <RiskRibbon compact />
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Continue" onPress={onContinue} disabled={!canContinue} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}</Text>
      <Text style={[styles.rowVal, bold && styles.rowBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  stepBtn: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.outlineVariant },
  stepperMid: { alignItems: 'center' },
  unitCount: { ...Typography.headlineMd, color: Colors.onSurface },
  unitLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.md },
  currency: { ...Typography.headlineMd, color: Colors.onSurface, marginRight: 4 },
  amountInput: { ...Typography.headlineMd, color: Colors.onSurface, flex: 1, paddingVertical: Spacing.md },
  minWarn: { ...Typography.labelSm, color: Colors.error },
  limitBox: {},
  limitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow },
  limitPass: { backgroundColor: Colors.iconBgTeal },
  limitWarn: { backgroundColor: Colors.iconBgGold },
  limitBlock: { backgroundColor: Colors.errorContainer },
  limitTextWrap: { flex: 1 },
  limitText: { ...Typography.labelLg, color: Colors.onSurface },
  limitSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  limitExplainer: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 6, lineHeight: 16 },
  summary: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.outlineVariant },
  summaryTitle: { ...Typography.labelLg, color: Colors.onSurface },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowVal: { ...Typography.bodyMd, color: Colors.onSurface },
  rowBold: { ...Typography.labelLg, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.outlineVariant },
  feeNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
