import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight, Lock } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  icon:        LucideIcon;
  label:       string;
  count:       number;
  lastUpdated?: string;          // ISO datetime
  restricted?: boolean;          // shows a lock affordance
  onPress?:    () => void;
}

// New component (W): a per-category record row (icon + label + count + restricted
// lock + chevron) for the records dashboard and per-patient record index.
// NotificationRow is notification-shaped and AlertCard composes a tinted alert,
// neither renders a count + restricted-lock category row, so this is justified.
export default function RecordCategoryRow({ icon: Icon, label, count, lastUpdated, restricted, onPress }: Props) {
  const updated = lastUpdated
    ? new Date(lastUpdated).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
    : undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && !!onPress && styles.pressed]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}, ${count} records${restricted ? ', restricted' : ''}`}
    >
      <View style={[styles.iconBox, { backgroundColor: Colors.iconBgPurple }]}>
        <Icon size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{label}</Text>
          {restricted && <Lock size={13} color={Colors.error} strokeWidth={2.2} />}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {count} {count === 1 ? 'record' : 'records'}{updated ? ` · updated ${updated}` : ''}
        </Text>
      </View>
      {!!onPress && <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  pressed:  { opacity: 0.7 },
  iconBox:  { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body:     { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  title:    { ...Typography.labelLg, color: Colors.onSurface },
  meta:     { ...Typography.caption, color: Colors.onSurfaceVariant },
});
