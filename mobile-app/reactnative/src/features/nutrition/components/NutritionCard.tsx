import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Flame, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import type { DishNutritionProfile, NutritionBand } from '../types';
import {
  STATUS_LABEL,
  isExact,
  isPointValue,
  formatNutrient,
  formatMacro,
  TRAFFIC_COLOR,
  TRAFFIC_BG,
  TRAFFIC_LABEL,
} from '../utils';
import NutritionBadge from './NutritionBadge';

// ─── Status provenance pill (NEVER omitted next to a number) ──────────────────
// Drives wording off the honesty STATUS so approval is never shown as exact:
//   • EXACT                → "from label"  (highest trust, real label)
//   • RESTAURANT_CONFIRMED → "restaurant-confirmed (estimate)"
//   • AI_ESTIMATE / STALE  → "AI estimate" / "recalculating"
function SourceBadge({ profile }: { profile: DishNutritionProfile }) {
  const label = STATUS_LABEL[profile.status];
  // Only a real label gets the high-trust pill; a confirmed estimate stays muted.
  const labelExact = isExact(profile.status);
  return (
    <View style={[styles.sourcePill, labelExact ? styles.sourcePillVerified : styles.sourcePillEst]}>
      <Text style={[styles.sourceText, labelExact ? styles.sourceTextVerified : styles.sourceTextEst]}>
        {label}
      </Text>
    </View>
  );
}

// ─── Light / Balanced / Heavy chip ────────────────────────────────────────────
const BAND_COLOR: Record<NutritionBand, { bg: string; fg: string }> = {
  Light: { bg: Colors.iconBgGreen, fg: '#16A34A' },
  Balanced: { bg: Colors.iconBgGold, fg: Colors.onWarning },
  Heavy: { bg: Colors.iconBgRed, fg: '#DC2626' },
};

function BandChip({ band }: { band: NutritionBand }) {
  const c = BAND_COLOR[band];
  return (
    <View style={[styles.bandChip, { backgroundColor: c.bg }]}>
      <Text style={[styles.bandText, { color: c.fg }]}>{band}</Text>
    </View>
  );
}

// ─── Traffic-light strip (sodium / sugar / sat-fat) ───────────────────────────
function TrafficStrip({ profile }: { profile: DishNutritionProfile }) {
  const tl = profile.display.traffic_lights;
  const items: { key: string; label: string; level: typeof tl.sodium_mg }[] = [
    { key: 'sodium', label: 'Salt', level: tl.sodium_mg },
    { key: 'sugar', label: 'Sugar', level: tl.sugar_g },
    { key: 'satfat', label: 'Sat fat', level: tl.sat_fat_g },
  ];
  return (
    <View style={styles.trafficStrip}>
      {items.map((it) => (
        <View key={it.key} style={[styles.trafficItem, { backgroundColor: TRAFFIC_BG[it.level] }]}>
          <View style={[styles.dot, { backgroundColor: TRAFFIC_COLOR[it.level] }]} />
          <Text style={styles.trafficLabel}>{it.label}</Text>
          <Text style={[styles.trafficLevel, { color: TRAFFIC_COLOR[it.level] }]}>
            {TRAFFIC_LABEL[it.level]}
          </Text>
        </View>
      ))}
    </View>
  );
}

interface Props {
  profile: DishNutritionProfile;
  /** Compact inline variant used inside a dish row. */
  compact?: boolean;
}

/**
 * HONEST-PRECISION nutrition card. The core invariant: a calorie/macro number
 * is NEVER rendered without its status (source + confidence), and approval is
 * NEVER shown as exact/verified.
 *   • EXACT                → "540 kcal" + "from label"
 *   • RESTAURANT_CONFIRMED → "540 kcal" + "restaurant-confirmed (estimate)"
 *   • AI_ESTIMATE          → "≈610–710 kcal · estimated" + "AI estimate"
 */
export default function NutritionCard({ profile, compact }: Props) {
  const ps = profile.per_serving;
  const pointValue = isPointValue(profile.status);
  // The "· estimated" qualifier rides ranges (AI estimates). A confirmed estimate
  // already carries "(estimate)" in its status pill, so no redundant tag there.
  const showEstTag = !pointValue;
  const energy = formatNutrient(ps.energy_kcal, 'kcal', profile.status);
  const verified = profile.badges.includes('Nutrition-Verified');

  if (compact) {
    return (
      <View style={styles.compactWrap}>
        <Flame size={13} color={Colors.onWarning} strokeWidth={2.2} />
        <Text style={styles.compactEnergy}>{energy}</Text>
        {showEstTag ? <Text style={styles.compactEst}>· estimated</Text> : null}
        <SourceBadge profile={profile} />
        {verified ? <NutritionBadge compact /> : null}
      </View>
    );
  }

  const macros: { label: string; text: string }[] = [
    { label: 'Protein', text: formatMacro(ps.protein_g, profile.status) },
    { label: 'Carbs', text: formatMacro(ps.carb_g, profile.status) },
    { label: 'Fat', text: formatMacro(ps.fat_g, profile.status) },
    { label: 'Fiber', text: formatMacro(ps.fiber_g, profile.status) },
  ];

  return (
    <View style={[styles.card, shadow1]}>
      {/* Header: honest energy headline + provenance */}
      <View style={styles.headerRow}>
        <View style={styles.energyWrap}>
          <View style={styles.energyLine}>
            <Flame size={18} color={Colors.onWarning} strokeWidth={2.2} />
            <Text style={styles.energyValue}>{energy}</Text>
            {showEstTag ? <Text style={styles.estTag}>· estimated</Text> : null}
          </View>
          <View style={styles.provRow}>
            <SourceBadge profile={profile} />
            <Text style={styles.portion}>per serving · {profile.portion_size_g} g</Text>
          </View>
        </View>
        <BandChip band={profile.display.band} />
      </View>

      {verified ? (
        <View style={{ marginTop: Spacing.sm }}>
          <NutritionBadge />
        </View>
      ) : null}

      {/* Macros row */}
      <View style={styles.macroRow}>
        {macros.map((m) => (
          <View key={m.label} style={styles.macro}>
            <Text style={styles.macroValue}>{m.text}</Text>
            <Text style={styles.macroLabel}>{m.label}</Text>
          </View>
        ))}
      </View>

      {/* Traffic-light strip */}
      <TrafficStrip profile={profile} />

      {/* Footer disclaimer — never optional */}
      <View style={styles.footer}>
        <Info size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.disclaimer}>
          {profile.disclaimer || 'Estimated nutrition for education — not medical or dietary advice.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  energyWrap: { flex: 1, gap: 4 },
  energyLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  energyValue: { ...Typography.titleLg, color: Colors.onSurface },
  estTag: { ...Typography.labelSm, color: Colors.onWarning },
  provRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  portion: { ...Typography.labelSm, color: Colors.onSurfaceVariant },

  // Source provenance pill
  sourcePill: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full, borderWidth: 1 },
  sourcePillVerified: { backgroundColor: Colors.iconBgTeal, borderColor: 'rgba(72,184,172,0.4)' },
  sourcePillEst: { backgroundColor: Colors.surfaceContainerLow, borderColor: Colors.outlineVariant },
  sourceText: { ...Typography.caption },
  sourceTextVerified: { color: Colors.tertiaryContainer },
  sourceTextEst: { color: Colors.onSurfaceVariant },

  // Band chip
  bandChip: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  bandText: { ...Typography.labelSm },

  // Macros
  macroRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
  },
  macro: { flex: 1, alignItems: 'center', gap: 2 },
  macroValue: { ...Typography.labelMd, color: Colors.onSurface },
  macroLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },

  // Traffic light
  trafficStrip: { flexDirection: 'row', gap: Spacing.sm },
  trafficItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 6,
    borderRadius: Radius.md,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  trafficLabel: { ...Typography.caption, color: Colors.onSurface },
  trafficLevel: { ...Typography.caption, fontWeight: '700' as const },

  // Footer
  footer: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  disclaimer: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },

  // Compact inline (dish row)
  compactWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  compactEnergy: { ...Typography.labelSm, color: Colors.onSurface },
  compactEst: { ...Typography.caption, color: Colors.onWarning },
});
