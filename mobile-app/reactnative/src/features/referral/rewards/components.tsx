import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { TIER_COLORS, RewardColors, tierDef } from './constants';
import type { ReferralTier } from './constants';

// ── Screen header (module-local so it doesn't depend on the legacy referral
// tree's notification/help routes). ─────────────────────────────────────────
export function RewardHeader({
  title,
  eyebrow,
  showBack = true,
  right,
  onBack,
  style,
}: {
  title: string;
  eyebrow?: string;
  showBack?: boolean;
  right?: React.ReactNode;
  onBack?: () => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[hStyles.container, style]}>
      {showBack ? (
        <Pressable onPress={onBack ?? (() => router.back())} hitSlop={10} style={hStyles.iconBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      ) : (
        <View style={hStyles.iconBtn} />
      )}
      <View style={hStyles.titleWrap}>
        {eyebrow ? <Text style={hStyles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={hStyles.title} numberOfLines={1}>{title}</Text>
      </View>
      <View style={hStyles.rightWrap}>{right ?? <View style={hStyles.iconBtn} />}</View>
    </View>
  );
}

const hStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.background,
  },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1 },
  rightWrap: { minWidth: 40, alignItems: 'flex-end' },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { ...Typography.titleLg, color: Colors.onSurface },
});

// ── Tier badge ───────────────────────────────────────────────────────────────
export function TierBadge({ tier, size = 'md' }: { tier: ReferralTier; size?: 'sm' | 'md' }) {
  const c = TIER_COLORS[tier];
  const def = tierDef(tier);
  const small = size === 'sm';
  return (
    <View style={[bStyles.badge, { backgroundColor: c.bg }, small && bStyles.badgeSm]}>
      <Text style={[bStyles.badgeText, { color: c.fg }, small && bStyles.badgeTextSm]}>{def.label}</Text>
    </View>
  );
}

const bStyles = StyleSheet.create({
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full, alignSelf: 'flex-start' },
  badgeSm: { paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { ...Typography.labelMd, fontWeight: '700' },
  badgeTextSm: { ...Typography.labelSm, fontWeight: '700' },
});

// ── Progress bar ─────────────────────────────────────────────────────────────
export function ProgressBar({ progress, color = RewardColors.brand }: { progress: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <View style={pStyles.track}>
      <View style={[pStyles.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

const pStyles = StyleSheet.create({
  track: { height: 10, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
});

// ── Status chip (reused by referrals + earnings) ─────────────────────────────
export function Chip({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <View style={[cStyles.chip, { backgroundColor: bg }]}>
      <Text style={[cStyles.chipText, { color: fg }]}>{label}</Text>
    </View>
  );
}

const cStyles = StyleSheet.create({
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.full, alignSelf: 'flex-start' },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
});

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[dStyles.card, style]}>{children}</View>;
}

const dStyles = StyleSheet.create({
  card: {
    backgroundColor: RewardColors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: RewardColors.border,
  },
});
