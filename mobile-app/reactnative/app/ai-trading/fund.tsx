// ── AI Trading — Fund the trading wallet (subscribe) — §16A #13 ────────────────
// Moves cash from the base Paymax wallet into the fund, minting units at the
// current NAV. Shows the unit price and units-to-mint before confirming.
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { usePosition, useSubscribe } from '@/features/aitrading/hooks';
import { formatNaira, formatUnits, UNIT_SCALE } from '@/features/aitrading/api';
import { alertAsync } from '@/lib/confirm';

export default function FundScreen() {
  const pos = usePosition();
  const subscribe = useSubscribe();
  const [amount, setAmount] = useState('');

  const kobo = Math.round((Number(amount.replace(/[^0-9.]/g, '')) || 0) * 100);
  const nav = pos.data?.navPerUnitKobo ?? UNIT_SCALE;
  const unitsToMint = kobo > 0 ? Math.floor((kobo * UNIT_SCALE) / nav) : 0;
  const valid = kobo > 0;

  async function onFund() {
    if (!valid) return;
    try {
      const r = await subscribe.mutateAsync(kobo);
      await alertAsync({ title: 'Funded', message: `${formatUnits(r.unitsMinted)} units added at ${formatNaira(r.navPerUnitKobo)} each.`, buttonLabel: 'Done' });
      goBack('/ai-trading');
    } catch (e) {
      alertAsync({ title: 'Could not fund', message: e instanceof Error ? e.message : 'Please try again.' });
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack('/ai-trading')} hitSlop={12} accessibilityLabel="Back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.topTitle}>Fund trading wallet</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Amount to deposit (₦)</Text>
        <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={Colors.onSurfaceVariant} autoFocus />

        <View style={styles.card}>
          <Row k="Current unit price (NAV)" v={formatNaira(nav)} />
          <Row k="Units you'll receive" v={unitsToMint > 0 ? formatUnits(unitsToMint) : '—'} />
        </View>

        <View style={styles.noteRow}>
          <Info size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.note}>Funds move from your Paymax wallet into the trading fund and are held segregated. You buy units at the current NAV; your holding is valued at NAV thereafter. You can lose deposited capital.</Text>
        </View>

        <View style={{ height: Spacing.md }} />
        <PrimaryButton label={subscribe.isPending ? 'Funding…' : 'Fund'} onPress={onFund} disabled={!valid || subscribe.isPending} />
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <View style={styles.kvRow}><Text style={styles.kvKey}>{k}</Text><Text style={styles.kvVal}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  topTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  body: { padding: Spacing.lg, gap: Spacing.sm },
  label: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  input: { ...Typography.headlineMd, color: Colors.onSurface, borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 14, backgroundColor: Colors.surface },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, marginTop: Spacing.sm },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
  kvKey: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  kvVal: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '700' },
  noteRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: Spacing.sm },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
});
