import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useHoldings, useListFraction } from '@/features/fractionalre/hooks';
import { formatNaira, makeIdempotencyKey } from '@/features/fractionalre/utils';
import type { Holding } from '@/features/fractionalre/types';

export default function ListFractionScreen() {
  const params = useLocalSearchParams<{ holdingId?: string }>();
  const holdings = useHoldings();
  const listMut = useListFraction();

  const [selectedId, setSelectedId] = useState<string | undefined>(params.holdingId);
  const [units, setUnits] = useState('');
  const [priceNaira, setPriceNaira] = useState('');

  const selected: Holding | undefined = (holdings.data ?? []).find((h) => h.id === selectedId);
  const navPerUnitKobo = selected ? Math.round(selected.currentValueKobo / selected.units) : 0;
  const unitsNum = parseInt(units || '0', 10);
  const priceKobo = Math.round((parseFloat(priceNaira) || 0) * 100);
  const overUnits = selected ? unitsNum > selected.units : false;

  const canList = !!selected && unitsNum > 0 && !overUnits && priceKobo > 0 && !listMut.isPending;

  const onList = async () => {
    if (!selected) return;
    try {
      await listMut.mutateAsync({
        input: { holdingId: selected.id, units: unitsNum, pricePerUnitKobo: priceKobo },
        idempotencyKey: makeIdempotencyKey('fre-list'),
      });
      Alert.alert('Listed', 'Your fraction is now on the secondary market.', [
        { text: 'OK', onPress: () => router.replace('/fractionalre/market/orders') },
      ]);
    } catch {
      Alert.alert('Could not list', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="List my fraction" subtitle="NAV-anchored resale" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {holdings.isLoading ? (
          <StateView kind="loading" compact message="Loading holdings…" />
        ) : (holdings.data?.length ?? 0) === 0 ? (
          <StateView kind="empty" title="No holdings to list" message="You need units in a holding to list them." icon="Building2" />
        ) : (
          <>
            <Text style={styles.label}>Select a holding</Text>
            {(holdings.data ?? []).map((h) => {
              const active = h.id === selectedId;
              return (
                <Pressable key={h.id} style={[styles.holdRow, active && styles.holdRowOn]} onPress={() => setSelectedId(h.id)}>
                  <View style={[styles.radio, active && styles.radioOn]}>
                    {active ? <Check size={12} color={Colors.onPrimary} strokeWidth={3} /> : null}
                  </View>
                  <View style={styles.holdText}>
                    <Text style={styles.holdTitle} numberOfLines={1}>{h.title}</Text>
                    <Text style={styles.holdSub}>{h.units} units · NAV {formatNaira(Math.round(h.currentValueKobo / h.units))}/unit</Text>
                  </View>
                </Pressable>
              );
            })}

            {selected ? (
              <>
                <Text style={styles.label}>Units to list (max {selected.units})</Text>
                <TextInput value={units} onChangeText={(t) => setUnits(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" style={styles.input} placeholder="0" placeholderTextColor={Colors.onSurfaceVariant} />
                {overUnits ? <Text style={styles.warn}>You only hold {selected.units} units.</Text> : null}

                <Text style={styles.label}>Price per unit (₦)</Text>
                <TextInput value={priceNaira} onChangeText={(t) => setPriceNaira(t.replace(/[^0-9.]/g, ''))} keyboardType="numeric" style={styles.input} placeholder={String(navPerUnitKobo / 100)} placeholderTextColor={Colors.onSurfaceVariant} />
                <Text style={styles.navHint}>Reference NAV: {formatNaira(navPerUnitKobo)} per unit. Listings far from NAV may take longer to fill.</Text>

                {unitsNum > 0 && priceKobo > 0 ? (
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total ask</Text>
                    <Text style={styles.totalVal}>{formatNaira(unitsNum * priceKobo)}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="List fraction" onPress={onList} disabled={!canList} loading={listMut.isPending} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  holdRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  holdRowOn: { borderColor: Colors.primary },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  holdText: { flex: 1 },
  holdTitle: { ...Typography.labelLg, color: Colors.onSurface },
  holdSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  input: { ...Typography.titleMd, color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  warn: { ...Typography.labelSm, color: Colors.error },
  navHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 16 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.sm },
  totalLabel: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  totalVal: { ...Typography.titleMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
