import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowLeftRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { formatKobo } from '@/api/doctor.batch3.api';
import type { DrugAlternative } from '@/types/doctor.batch3';

interface Props {
  alternative: DrugAlternative;
  onSelect:    (alt: DrugAlternative) => void;
}

// New component: a generic/brand alternative swap row used in the alternatives
// sheet. It pairs a kind chip + name + strength + indicative price (kobo via
// formatKobo) + swap affordance — no existing row composes this, so it is new.
export default function AlternativeRow({ alternative, onSelect }: Props) {
  const isBrand = alternative.kind === 'brand';
  return (
    <Pressable
      style={styles.row}
      onPress={() => onSelect(alternative)}
      accessibilityRole="button"
      accessibilityLabel={`Use ${alternative.name} (${alternative.kind})`}
    >
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>{alternative.name}</Text>
          <View style={[styles.kindChip, isBrand ? styles.kindBrand : styles.kindGeneric]}>
            <Text style={[styles.kindText, isBrand ? styles.kindTextBrand : styles.kindTextGeneric]}>
              {isBrand ? 'Brand' : 'Generic'}
            </Text>
          </View>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {[alternative.strength, alternative.note].filter(Boolean).join(' · ')}
        </Text>
        {typeof alternative.priceKobo === 'number' && (
          <Text style={styles.price}>{formatKobo(alternative.priceKobo)}</Text>
        )}
      </View>
      <View style={styles.swap}>
        <ArrowLeftRight size={16} color={Colors.primary} strokeWidth={2.2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row:             { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  body:            { flex: 1, gap: 2 },
  titleRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name:            { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  kindChip:        { height: 22, paddingHorizontal: 8, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  kindGeneric:     { backgroundColor: Colors.iconBgTeal },
  kindBrand:       { backgroundColor: Colors.iconBgPurple },
  kindText:        { ...Typography.labelSm, fontWeight: '700' },
  kindTextGeneric: { color: Colors.teal },
  kindTextBrand:   { color: Colors.primary },
  meta:            { ...Typography.caption, color: Colors.onSurfaceVariant },
  price:           { ...Typography.labelMd, color: Colors.onSurface },
  swap:            { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryFixed },
});
