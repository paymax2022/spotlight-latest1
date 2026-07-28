import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Minus, Plus, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatNairaWhole, formatFareRange } from '../utils/mobilityFormatters';
import type { Kobo } from '../types/mobility.types';

interface Props {
  systemFareKobo: Kobo;
  offerMinKobo: Kobo;      // server floor — display & clamp only
  offerMaxKobo: Kobo;      // server ceiling
  value: Kobo;
  onChange: (kobo: Kobo) => void;
  stepKobo?: Kobo;
  error?: string | null;
}

/**
 * Rider fare-offer control. The min/max are the SERVER-computed floor/ceiling;
 * the client clamps within them for UX but the backend re-validates (422 on
 * violation). Never compute the floor here.
 */
export default function FareOfferSheet({
  systemFareKobo,
  offerMinKobo,
  offerMaxKobo,
  value,
  onChange,
  stepKobo = 50_00,
  error,
}: Props) {
  const clamp = (k: Kobo) => Math.max(offerMinKobo, Math.min(offerMaxKobo, k));
  const dec = () => onChange(clamp(value - stepKobo));
  const inc = () => onChange(clamp(value + stepKobo));
  const atFloor = value <= offerMinKobo;
  const atCeiling = value >= offerMaxKobo;

  const pct = Math.round((value / systemFareKobo) * 100);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Your fare offer</Text>

      <View style={styles.stepper}>
        <Pressable onPress={dec} disabled={atFloor} style={[styles.stepBtn, atFloor && styles.stepBtnDisabled]} accessibilityLabel="Lower offer">
          <Minus size={22} color={atFloor ? Colors.outline : Colors.primary} strokeWidth={2.4} />
        </Pressable>
        <View style={styles.amountWrap}>
          <Text style={styles.amount}>{formatNairaWhole(value)}</Text>
          <Text style={styles.pct}>{pct}% of standard fare</Text>
        </View>
        <Pressable onPress={inc} disabled={atCeiling} style={[styles.stepBtn, atCeiling && styles.stepBtnDisabled]} accessibilityLabel="Raise offer">
          <Plus size={22} color={atCeiling ? Colors.outline : Colors.primary} strokeWidth={2.4} />
        </Pressable>
      </View>

      {/* Quick presets clamped to the allowed band */}
      <View style={styles.presets}>
        {[offerMinKobo, systemFareKobo, offerMaxKobo].map((preset, i) => {
          const label = i === 0 ? 'Min' : i === 1 ? 'Standard' : 'Max';
          const active = value === preset;
          return (
            <Pressable key={label} onPress={() => onChange(clamp(preset))} style={[styles.preset, active && styles.presetActive]}>
              <Text style={[styles.presetLabel, active && styles.presetLabelActive]}>{label}</Text>
              <Text style={[styles.presetValue, active && styles.presetLabelActive]}>{formatNairaWhole(preset)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.note}>
        <Info size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.noteText}>
          Allowed range {formatFareRange(offerMinKobo, offerMaxKobo)}. Offers below the fair floor are rejected to keep drivers profitable.
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.md },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  stepBtn: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.outlineVariant },
  stepBtnDisabled: { opacity: 0.5 },
  amountWrap: { alignItems: 'center', flex: 1 },
  amount: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
  pct: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  presets: { flexDirection: 'row', gap: Spacing.sm },
  preset: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  presetActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  presetLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  presetValue: { ...Typography.labelMd, color: Colors.onSurface, marginTop: 2 },
  presetLabelActive: { color: Colors.primary },
  note: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
  error: { ...Typography.labelSm, color: Colors.error },
});
