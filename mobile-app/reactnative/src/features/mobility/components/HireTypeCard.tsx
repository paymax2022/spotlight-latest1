import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

interface Props {
  title: string;
  hint?: string;
  icon?: string; // lucide name
  selected: boolean;
  onPress: () => void;
}

/**
 * Hire-type chooser tile. The car-hire screen offers four fixed, mutually
 * exclusive hire types (hourly / daily / airport / event), each with an icon and
 * a one-line hint. The shared SelectableCard is a full-width ROW (icon · text ·
 * check); forcing it into a half-width grid cell cramped the icon against a
 * wrapping hint. This tile stacks vertically instead — icon top-left, a check
 * badge top-right when selected, label and hint below — so a narrow 2-up cell
 * reads cleanly and all four options stay visible without scrolling. Selected
 * state reuses the app-wide selector language (primary border + primaryFixed
 * fill + check) so it matches every other mode selector.
 */
export default function HireTypeCard({ title, hint, icon, selected, onPress }: Props) {
  const Icon = icon ? ((Icons as unknown as Record<string, Icons.LucideIcon>)[icon] ?? Icons.Circle) : null;
  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={hint ? `${title}. ${hint}` : title}
    >
      <View style={styles.topRow}>
        {Icon && (
          <View style={[styles.iconBox, selected && styles.iconBoxSelected]}>
            <Icon size={20} color={selected ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
          </View>
        )}
        <View style={[styles.check, selected && styles.checkOn]}>
          {selected && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
        </View>
      </View>
      <Text style={[styles.title, selected && styles.titleSelected]} numberOfLines={1}>{title}</Text>
      {hint ? <Text style={styles.hint} numberOfLines={2}>{hint}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    // 47% basis + grow → exactly two tiles per row (3x47% can't fit), the pair
    // then grows to fill the row; four hire types land as a tidy 2x2.
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 112,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    gap: Spacing.sm,
  },
  cardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  iconBoxSelected: { backgroundColor: Colors.surfaceContainerLowest },
  // Unselected: a hairline ring that fills in on select — keeps the tile's
  // top-right corner balanced against the icon whether or not it is chosen.
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  checkOn: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  titleSelected: { color: Colors.primary },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
