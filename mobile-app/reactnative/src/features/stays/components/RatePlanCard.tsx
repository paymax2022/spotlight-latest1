import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check, Coffee, Smartphone, ShieldCheck, Ban } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatMoney, formatNairaCompact, usdCentsToNgnKobo, StaysColors } from '../constants/stays.constants';
import type { RatePlan } from '../types';

const BOARD_LABEL: Record<RatePlan['board'], string> = {
  room_only: 'Room only',
  breakfast: 'Breakfast included',
  half_board: 'Half board',
  full_board: 'Full board',
};

interface Props {
  plan: RatePlan;
  selected?: boolean;
  onSelect: () => void;
}

/** Rate-plan comparison card (refundable / non-ref / breakfast / mobile). */
export default function RatePlanCard({ plan, selected, onSelect }: Props) {
  const ngnNote = plan.currency === 'USD' ? `≈ ${formatNairaCompact(usdCentsToNgnKobo(plan.pricePerNightMinor))}` : null;
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.card, selected && styles.selected]}
    >
      <View style={styles.header}>
        <Text style={styles.name}>{plan.name}</Text>
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected ? <Check size={14} color={Colors.white} strokeWidth={3} /> : null}
        </View>
      </View>

      <View style={styles.tags}>
        {plan.board !== 'room_only' ? (
          <Tag icon={<Coffee size={12} color={StaysColors.ok} strokeWidth={2} />} label={BOARD_LABEL[plan.board]} tone="ok" />
        ) : (
          <Tag label={BOARD_LABEL[plan.board]} tone="muted" />
        )}
        {plan.refundable ? (
          <Tag icon={<ShieldCheck size={12} color={StaysColors.ok} strokeWidth={2} />} label="Free cancellation" tone="ok" />
        ) : (
          <Tag icon={<Ban size={12} color={Colors.error} strokeWidth={2} />} label="Non-refundable" tone="danger" />
        )}
        {plan.mobileOnly ? (
          <Tag icon={<Smartphone size={12} color={StaysColors.accent} strokeWidth={2} />} label="Mobile rate" tone="accent" />
        ) : null}
      </View>

      <View style={styles.priceRow}>
        <View>
          <Text style={styles.price}>{formatMoney(plan.pricePerNightMinor, plan.currency)}</Text>
          <Text style={styles.perNight}>per night{ngnNote ? `  ·  ${ngnNote}` : ''}</Text>
        </View>
        {plan.loyaltyDiscountPct ? (
          <View style={styles.loyaltyChip}>
            <Text style={styles.loyaltyText}>-{plan.loyaltyDiscountPct}% loyalty</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function Tag({ icon, label, tone }: { icon?: React.ReactNode; label: string; tone: 'ok' | 'danger' | 'accent' | 'muted' }) {
  const bg = {
    ok: Colors.iconBgTeal,
    danger: Colors.errorContainer,
    accent: Colors.iconBgBlue,
    muted: Colors.surfaceContainerHigh,
  }[tone];
  const color = {
    ok: StaysColors.ok,
    danger: Colors.error,
    accent: StaysColors.accent,
    muted: Colors.onSurfaceVariant,
  }[tone];
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      {icon}
      <Text style={[styles.tagText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  selected: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  tagText: { ...Typography.labelSm, fontWeight: '700' as const },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  price: { ...Typography.titleLg, color: Colors.onSurface },
  perNight: { ...Typography.caption, color: Colors.onSurfaceVariant },
  loyaltyChip: { backgroundColor: Colors.iconBgGold, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  loyaltyText: { ...Typography.labelSm, color: Colors.onWarning, fontWeight: '700' as const },
});
