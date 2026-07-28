import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { FlaskConical, Clock, Droplet, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { formatNaira } from '../../constants/health.constants';
import type { LabTest } from '../types';

/** Catalog row for a single test: name, code, prep/TAT chips and price. */
export default function LabTestCard({ test, onPress }: { test: LabTest; onPress: () => void }) {
  return (
    <Pressable style={[styles.card, shadow1]} onPress={onPress} accessibilityRole="button">
      <View style={[styles.icon, { backgroundColor: test.imageColor }]}>
        <FlaskConical size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {test.name}
        </Text>
        <Text style={styles.code} numberOfLines={1}>
          {test.code} · {test.description}
        </Text>
        <View style={styles.chips}>
          <View style={styles.chip}>
            <Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.chipText}>{test.tat}</Text>
          </View>
          {test.fastingRequired ? (
            <View style={[styles.chip, styles.chipWarn]}>
              <Droplet size={12} color={Colors.onWarning} strokeWidth={2} />
              <Text style={[styles.chipText, { color: Colors.onWarning }]}>Fasting</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.price}>{formatNaira(test.priceKobo)}</Text>
      </View>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  icon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  code: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  chips: { flexDirection: 'row', gap: Spacing.xs, marginTop: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  chipWarn: { backgroundColor: Colors.iconBgGold },
  chipText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  price: { ...Typography.labelLg, color: Colors.primary, marginTop: 4 },
});
