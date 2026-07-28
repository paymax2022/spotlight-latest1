import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  label:       string;
  description?: string;
  value:       boolean;
  onValueChange: (value: boolean) => void;
  icon?:       LucideIcon;
  iconColor?:  string;
  bgColor?:    string;
  disabled?:   boolean;
}

// New component: a labelled switch row for online/offline + notification/settings
// toggles. ProfileMenuItem is a navigation row (chevron, no switch), so a row
// with an embedded Switch is genuinely new.
export default function ToggleRow({ label, description, value, onValueChange, icon: Icon, iconColor = Colors.primary, bgColor = Colors.iconBgPurple, disabled }: Props) {
  return (
    <View style={styles.row}>
      {Icon && (
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <Icon size={20} color={iconColor} strokeWidth={1.8} />
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        {!!description && <Text style={styles.description} numberOfLines={2}>{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: Colors.surfaceContainerHigh, true: Colors.primaryContainer }}
        thumbColor={value ? Colors.primary : Colors.surfaceContainerLowest}
        ios_backgroundColor={Colors.surfaceContainerHigh}
        accessibilityLabel={label}
        accessibilityRole="switch"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2, paddingHorizontal: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg },
  iconBox:     { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body:        { flex: 1, gap: 2 },
  label:       { ...Typography.bodyMd, color: Colors.onSurface },
  description: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
