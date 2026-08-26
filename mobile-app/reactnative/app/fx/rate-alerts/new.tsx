import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedTabs from '@/components/SegmentedControl';
import CurrencyChip from '@/features/fx/components/CurrencyChip';
import CurrencyPickerSheet from '@/features/fx/components/CurrencyPickerSheet';
import RateSparkline from '@/features/fx/components/RateSparkline';
import { useRateHistory, useCreateRateAlert } from '@/features/fx/hooks/useFx';
import { midRate, formatRate } from '@/features/fx/utils/fxFormatters';
import { sanitizeMoneyInput } from '@/utils/money';
import { CURRENCY_ORDER } from '@/features/fx/constants/fx.constants';
import type { CurrencyCode, RateAlertDirection } from '@/features/fx/types/fx.types';

export default function NewRateAlertScreen() {
  const [from, setFrom] = useState<CurrencyCode>('USD');
  const [to, setTo] = useState<CurrencyCode>('NGN');
  const [direction, setDirection] = useState<RateAlertDirection>('above');
  const [target, setTarget] = useState('');
  const [picker, setPicker] = useState<null | 'from' | 'to'>(null);

  const history = useRateHistory(from, to, '1M');
  const create = useCreateRateAlert();
  const current = useMemo(() => midRate(from, to), [from, to]);
  const chartW = Dimensions.get('window').width - Spacing.containerMargin * 2 - Spacing.md * 2;

  const targetNum = parseFloat(target.replace(/[^0-9.]/g, '')) || 0;
  const disabled = targetNum <= 0 || from === to;

  const save = async () => {
    await create.mutateAsync({ from, to, direction, target: targetNum });
    goBack('/fx/rate-alerts');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New rate alert" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Pair */}
        <View style={styles.pairRow}>
          <View style={styles.pairCol}>
            <Text style={styles.label}>From</Text>
            <CurrencyChip currency={from} onPress={() => setPicker('from')} />
          </View>
          <Text style={styles.arrow}>→</Text>
          <View style={styles.pairCol}>
            <Text style={styles.label}>To</Text>
            <CurrencyChip currency={to} onPress={() => setPicker('to')} />
          </View>
        </View>

        {/* Current rate + chart */}
        <View style={styles.chartCard}>
          <Text style={styles.curLabel}>Current rate</Text>
          <Text style={styles.curRate}>{formatRate(from, to, current)}</Text>
          <RateSparkline data={history.data ?? []} width={chartW} height={100} color={Colors.secondary} />
        </View>

        {/* Direction */}
        <Text style={styles.label}>Notify me when the rate goes</Text>
        <SegmentedTabs<RateAlertDirection>
          value={direction}
          onChange={setDirection}
          options={[{ value: 'above', label: 'Above' }, { value: 'below', label: 'Below' }]}
        />

        {/* Target */}
        <Text style={[styles.label, styles.targetLabel]}>Target rate</Text>
        <View style={styles.targetWrap}>
          <Text style={styles.targetPrefix}>1 {from} =</Text>
          <TextInput
            style={styles.targetInput}
            value={target}
            onChangeText={(v) => setTarget(sanitizeMoneyInput(v))}
            placeholder={current.toFixed(2)}
            placeholderTextColor={Colors.outline}
            keyboardType="decimal-pad"
            inputMode="decimal"
            maxLength={13}
            accessibilityLabel="Target rate"
          />
          <Text style={styles.targetSuffix}>{to}</Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Create alert" onPress={save} loading={create.isPending} disabled={disabled} />
      </SafeAreaView>

      <CurrencyPickerSheet
        visible={picker !== null}
        title={picker === 'from' ? 'Base currency' : 'Quote currency'}
        value={picker === 'from' ? from : to}
        options={CURRENCY_ORDER}
        disabled={picker === 'from' ? [to] : [from]}
        onSelect={(c) => { if (picker === 'from') setFrom(c); else setTo(c); }}
        onClose={() => setPicker(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  pairRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.md, marginBottom: Spacing.lg },
  pairCol: { gap: Spacing.xs },
  arrow: { ...Typography.titleLg, color: Colors.outline, marginBottom: 8 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  chartCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.lg,
  },
  curLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  curRate: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2, marginBottom: Spacing.sm },
  targetLabel: { marginTop: Spacing.lg },
  targetWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.secondary, paddingHorizontal: Spacing.md, height: 60,
  },
  targetPrefix: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  targetInput: { flex: 1, ...Typography.titleLg, color: Colors.onSurface, padding: 0 },
  targetSuffix: { ...Typography.labelLg, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
