import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import CryptoSparkline from '@/features/crypto/components/CryptoSparkline';
import { useAssets, useChart, useCreateAlert } from '@/features/crypto/hooks/useCrypto';
import { formatFiatObj, formatPrice, parseFiatToMinor } from '@/features/crypto/utils/cryptoFormatters';
import { DEFAULT_FIAT } from '@/features/crypto/constants/crypto.constants';
import type { AlertCondition } from '@/features/crypto/types/crypto.types';
import { sanitizeMoneyInput } from '@/utils/money';

export default function NewCryptoAlertScreen() {
  const params = useLocalSearchParams<{ symbol?: string }>();
  const assets = useAssets();
  const tradable = useMemo(() => (assets.data ?? []).filter((a) => a.status === 'active'), [assets.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [condition, setCondition] = useState<AlertCondition>('above');
  const [target, setTarget] = useState('');

  // Resolve the selected asset (param symbol → explicit pick → first tradable).
  const selected =
    tradable.find((a) => a.id === selectedId) ??
    tradable.find((a) => a.symbol === params.symbol) ??
    tradable[0];

  const chart = useChart(selected?.symbol, '1M');
  const create = useCreateAlert();
  const fiat = DEFAULT_FIAT;
  const chartW = Dimensions.get('window').width - Spacing.containerMargin * 2 - Spacing.md * 2;

  if (assets.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="New price alert" />
        <StateView kind="loading" message="Loading assets…" />
      </SafeAreaView>
    );
  }
  if (!selected) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="New price alert" />
        <StateView kind="empty" icon="Bell" title="No assets to track" message="There are no tradable assets right now." />
      </SafeAreaView>
    );
  }

  const targetMinor = parseFiatToMinor(target, fiat);
  const disabled = targetMinor <= 0 || create.isPending;

  const save = async () => {
    await create.mutateAsync({ assetId: selected.id, condition, targetPrice: targetMinor, currency: fiat });
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New price alert" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Asset chooser */}
        <Text style={styles.label}>Asset</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assetRow}>
          {tradable.map((a) => {
            const active = a.id === selected.id;
            return (
              <Pressable
                key={a.id}
                onPress={() => setSelectedId(a.id)}
                style={[styles.assetChip, active && styles.assetChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <AssetIcon symbol={a.symbol} color={a.iconColor} size={24} />
                <Text style={[styles.assetChipText, active && styles.assetChipTextActive]}>{a.symbol}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Current price + chart */}
        <View style={styles.chartCard}>
          <Text style={styles.curLabel}>Current price</Text>
          <Text style={styles.curRate}>{formatPrice(selected.symbol, selected.price)}</Text>
          <CryptoSparkline data={chart.data ?? []} width={chartW} height={100} color={Colors.secondary} />
        </View>

        {/* Condition */}
        <Text style={styles.label}>Notify me when the price goes</Text>
        <SegmentedControl<AlertCondition>
          value={condition}
          onChange={setCondition}
          options={[{ value: 'above', label: 'Above' }, { value: 'below', label: 'Below' }]}
        />

        {/* Target */}
        <Text style={[styles.label, styles.targetLabel]}>Target price (per {selected.symbol})</Text>
        <View style={styles.targetWrap}>
          <Text style={styles.targetPrefix}>₦</Text>
          <TextInput
            style={styles.targetInput}
            value={target}
            onChangeText={(v) => setTarget(sanitizeMoneyInput(v))}
            placeholder={String(selected.price.amount / 100)}
            placeholderTextColor={Colors.outline}
            keyboardType="decimal-pad"
            inputMode="decimal"
            maxLength={13}
            accessibilityLabel="Target price"
          />
        </View>
        <Text style={styles.hint}>Current: {formatFiatObj(selected.price)}</Text>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Create alert" onPress={save} loading={create.isPending} disabled={disabled} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  assetRow: { gap: Spacing.sm, paddingBottom: Spacing.md },
  assetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.transparent, paddingHorizontal: Spacing.sm + 2, paddingVertical: 6,
  },
  assetChipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  assetChipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  assetChipTextActive: { color: Colors.primary },
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
  targetPrefix: { ...Typography.titleLg, color: Colors.onSurfaceVariant },
  targetInput: { flex: 1, ...Typography.titleLg, color: Colors.onSurface, padding: 0 },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
