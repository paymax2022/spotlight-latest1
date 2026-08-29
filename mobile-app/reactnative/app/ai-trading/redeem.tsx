// ── AI Trading — Withdraw / redeem units — §16A #14 ────────────────────────────
// Redeems units at the current NAV, paying cash back to the base Paymax wallet.
// Supports "withdraw all" and shows the cash the redemption will pay.
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
import { usePosition, useRedeem } from '@/features/aitrading/hooks';
import { formatNaira, formatUnits, UNIT_SCALE } from '@/features/aitrading/api';
import { alertAsync } from '@/lib/confirm';

export default function RedeemScreen() {
  const pos = usePosition();
  const redeem = useRedeem();
  const held = pos.data?.units ?? 0;
  const nav = pos.data?.navPerUnitKobo ?? UNIT_SCALE;
  const [unitsInput, setUnitsInput] = useState('');

  const units = Math.min(held, Math.round((Number(unitsInput.replace(/[^0-9.]/g, '')) || 0) * UNIT_SCALE));
  const cash = units > 0 ? Math.round((units * nav) / UNIT_SCALE) : 0;
  const valid = units > 0 && units <= held;

  async function onRedeem() {
    if (!valid) return;
    try {
      const r = await redeem.mutateAsync(units);
      await alertAsync({ title: 'Withdrawal submitted', message: `${formatNaira(r.cashKobo)} paid to your Paymax wallet at ${formatNaira(r.navPerUnitKobo)} / unit.`, buttonLabel: 'Done' });
      goBack('/ai-trading');
    } catch (e) {
      alertAsync({ title: 'Could not withdraw', message: e instanceof Error ? e.message : 'Please try again.' });
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => goBack('/ai-trading')} hitSlop={12} accessibilityLabel="Back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.topTitle}>Withdraw</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Row k="Units held" v={formatUnits(held)} />
          <Row k="Unit price (NAV)" v={formatNaira(nav)} />
          <Row k="Holding value" v={formatNaira(Math.round((held * nav) / UNIT_SCALE))} />
        </View>

        <View style={styles.labelRow}>
          <Text style={styles.label}>Units to withdraw</Text>
          <Pressable onPress={() => setUnitsInput(String(held / UNIT_SCALE))}><Text style={styles.allBtn}>All</Text></Pressable>
        </View>
        <TextInput style={styles.input} value={unitsInput} onChangeText={setUnitsInput} keyboardType="numeric" placeholder="0" placeholderTextColor={Colors.onSurfaceVariant} />

        <View style={styles.card}>
          <Row k="You'll receive (at NAV)" v={cash > 0 ? formatNaira(cash) : '—'} />
        </View>

        <View style={styles.noteRow}>
          <Info size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.note}>Redemptions are paid at the fund's current NAV, net of any fees. Settlement may take time if positions must be closed. The final amount can differ from an estimate if NAV moves before settlement.</Text>
        </View>

        <View style={{ height: Spacing.md }} />
        <PrimaryButton label={redeem.isPending ? 'Withdrawing…' : 'Withdraw'} onPress={onRedeem} disabled={!valid || redeem.isPending} />
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
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, marginTop: Spacing.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.sm },
  label: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  allBtn: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' },
  input: { ...Typography.headlineMd, color: Colors.onSurface, borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 14, backgroundColor: Colors.surface },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
  kvKey: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  kvVal: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '700' },
  noteRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: Spacing.sm },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
});
