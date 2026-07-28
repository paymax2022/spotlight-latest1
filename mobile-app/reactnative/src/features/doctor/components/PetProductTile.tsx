import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  name:        string;
  brand:       string;
  categoryLabel: string;
  priceText:   string;            // pre-formatted via formatKobo
  vetApproved: boolean;
  swatch:      string;            // product swatch colour from data
  selected:    boolean;
  onToggle:    () => void;
}

// New component: a selectable pet-store product tile (swatch + name + brand +
// price + vet-approved flag + select check). LabTestRow is text-only with no
// price/swatch; a product tile for the recommendation builder is justified.
export default function PetProductTile({ name, brand, categoryLabel, priceText, vetApproved, swatch, selected, onToggle }: Props) {
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.card, selected && styles.cardSelected]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
    >
      <View style={[styles.swatch, { backgroundColor: swatch }]} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.brand} numberOfLines={1}>{brand} - {categoryLabel}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.price}>{priceText}</Text>
          {vetApproved && (
            <View style={styles.approved}>
              <ShieldCheck size={11} color={Colors.teal} strokeWidth={2.4} />
              <Text style={styles.approvedText}>Vet-approved</Text>
            </View>
          )}
        </View>
      </View>
      <View style={[styles.checkbox, selected && styles.checkboxOn]}>
        {selected && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.sm },
  cardSelected:{ borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  swatch:      { width: 44, height: 44, borderRadius: Radius.md },
  body:        { flex: 1, gap: 2 },
  name:        { ...Typography.labelLg, color: Colors.onSurface },
  brand:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  price:       { ...Typography.labelMd, color: Colors.onSurface },
  approved:    { flexDirection: 'row', alignItems: 'center', gap: 3, height: 20, paddingHorizontal: 6, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal },
  approvedText:{ ...Typography.caption, color: Colors.teal, fontWeight: '700' },
  checkbox:    { width: 24, height: 24, borderRadius: Radius.sm + 2, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
});
