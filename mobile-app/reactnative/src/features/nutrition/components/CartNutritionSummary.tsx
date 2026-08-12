import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Flame, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import { useCartNutrition } from '../hooks';
import {
  formatNutrient,
  TRAFFIC_COLOR,
  TRAFFIC_BG,
  TRAFFIC_LABEL,
  DECLARATION_LABEL,
} from '../utils';

/**
 * Aggregate cart nutrition: a kcal RANGE (honest — the cart total is estimated
 * whenever any line is), the worst-case traffic light across all dishes, a
 * distinct allergen line, and the standing disclaimer.
 */
export default function CartNutritionSummary({ ids }: { ids: string[] }) {
  const { data, isLoading } = useCartNutrition(ids);
  if (ids.length === 0 || isLoading || !data) return null;

  // Cart total never claims false precision: a range while any line is an
  // estimate, a point value only when every line is from a real label.
  const energy = formatNutrient(data.energy_kcal, 'kcal', data.estimated ? 'AI_ESTIMATE' : 'EXACT');
  const tl = data.traffic_lights;
  const items: { key: string; label: string; level: typeof tl.sodium_mg }[] = [
    { key: 'sodium', label: 'Salt', level: tl.sodium_mg },
    { key: 'sugar', label: 'Sugar', level: tl.sugar_g },
    { key: 'satfat', label: 'Sat fat', level: tl.sat_fat_g },
  ];

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.headerRow}>
        <Flame size={16} color={Colors.onWarning} strokeWidth={2.2} />
        <Text style={styles.energy}>{energy}</Text>
        {data.estimated ? <Text style={styles.estTag}>· estimated total</Text> : null}
      </View>

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
      <Text style={styles.worstNote}>Worst-case across your cart</Text>

      <View style={styles.footer}>
        <Info size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.disclaimer}>{data.disclaimer}</Text>
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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  energy: { ...Typography.titleMd, color: Colors.onSurface },
  estTag: { ...Typography.labelSm, color: Colors.onWarning },
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
  worstNote: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: -4 },
  footer: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  disclaimer: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1 },
});
