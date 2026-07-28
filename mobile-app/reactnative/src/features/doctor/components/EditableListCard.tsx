import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Pencil, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  title:    string;            // primary line, e.g. institution / organisation / clinic name
  subtitle?: string;           // secondary line, e.g. degree · years
  meta?:    string;            // small caption, e.g. location / status
  badge?:   string;            // optional pill text, e.g. "Primary" / "Current"
  onEdit?:  () => void;
  onRemove?: () => void;
}

// New component: a summary card with edit/remove affordances for the repeatable
// list entries (education, work experience, affiliations, certificates).
// DrugItemRow is an inline editor specific to prescriptions; a generic read-row
// with edit/remove actions is justified and reused across four screens.
export default function EditableListCard({ title, subtitle, meta, badge, onEdit, onRemove }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {!!badge && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          )}
        </View>
        {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        {!!meta && <Text style={styles.meta} numberOfLines={1}>{meta}</Text>}
      </View>
      <View style={styles.actions}>
        {onEdit && (
          <Pressable onPress={onEdit} hitSlop={8} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel={`Edit ${title}`}>
            <Pencil size={16} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        )}
        {onRemove && (
          <Pressable onPress={onRemove} hitSlop={8} style={[styles.actionBtn, styles.removeBtn]} accessibilityRole="button" accessibilityLabel={`Remove ${title}`}>
            <Trash2 size={16} color={Colors.error} strokeWidth={2} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.sm },
  body:      { flex: 1, gap: 2 },
  titleRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title:     { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  badge:     { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal },
  badgeText: { ...Typography.labelSm, color: Colors.teal, fontWeight: '700' },
  subtitle:  { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  meta:      { ...Typography.caption, color: Colors.onSurfaceVariant },
  actions:   { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgBlue },
  removeBtn: { backgroundColor: Colors.errorContainer },
});
