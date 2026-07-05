import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { ShieldCheck, ShieldPlus, ShieldAlert, ChevronRight } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { InsuranceColors, formatNaira } from '../constants/insurance.constants';
import type { CoverStatus } from '../embedded';

/**
 * Shared embedded-cover affordance (PRD §13 / §15.1) — the small inline badge
 * other modules (transport / parcel checkout) drop into their flow:
 *   • INSURED   → "Insured · <underwriter>"
 *   • AVAILABLE → "Add cover ₦X"
 *   • UNCOVERED → "No cover — add"
 *   • BINDING   → "Securing cover…"
 *
 * Underwriter is disclosed when insured (PRD §5 — never hard-coded by the host).
 * Money is kobo.
 */
export default function CoverBadge({
  status,
  premiumKobo,
  underwriter,
  onPress,
  style,
}: {
  status: CoverStatus;
  premiumKobo?: number;
  underwriter?: string;
  onPress?: () => void;
  style?: any;
}) {
  const cfg = CONFIG[status];
  const Icon = cfg.icon;
  const Wrapper: any = onPress ? Pressable : View;

  const label =
    status === 'INSURED'
      ? underwriter ? `Insured · ${underwriter}` : 'Insured'
      : status === 'AVAILABLE'
        ? premiumKobo != null ? `Add cover ${formatNaira(premiumKobo)}` : 'Add cover'
        : status === 'BINDING'
          ? 'Securing cover…'
          : 'No cover — add';

  return (
    <Wrapper
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      style={({ pressed }: { pressed?: boolean }) => [
        styles.badge,
        { backgroundColor: cfg.bg, borderColor: cfg.border },
        pressed && styles.pressed,
        style,
      ]}
    >
      <Icon size={15} color={cfg.fg} strokeWidth={2.2} />
      <Text style={[styles.label, { color: cfg.fg }]} numberOfLines={1}>{label}</Text>
      {onPress && status !== 'BINDING' ? <ChevronRight size={15} color={cfg.fg} /> : null}
    </Wrapper>
  );
}

const CONFIG: Record<CoverStatus, { icon: typeof ShieldCheck; fg: string; bg: string; border: string }> = {
  INSURED:   { icon: ShieldCheck, fg: InsuranceColors.ok,     bg: InsuranceColors.okBg,     border: 'transparent' },
  AVAILABLE: { icon: ShieldPlus,  fg: InsuranceColors.accent, bg: InsuranceColors.mycoverBg, border: 'transparent' },
  UNCOVERED: { icon: ShieldAlert, fg: InsuranceColors.warnText, bg: InsuranceColors.warn,   border: 'transparent' },
  BINDING:   { icon: ShieldCheck, fg: InsuranceColors.muted,  bg: InsuranceColors.surfaceAlt, border: InsuranceColors.border },
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.85 },
  label: { ...Typography.labelSm, fontWeight: '700' as const, flexShrink: 1 },
});
