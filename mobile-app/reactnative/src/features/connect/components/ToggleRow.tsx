import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

interface Props {
  label: string;
  sub?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  locked?: boolean;     // shows "Always on" instead of a toggle
  divider?: boolean;
}

/** Settings toggle row reused across notifications / privacy / data-saver. */
export default function ToggleRow({ label, sub, value, onValueChange, disabled, locked, divider }: Props) {
  return (
    <View style={[styles.row, divider && styles.divider]}>
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {locked ? (
        <Text style={styles.locked}>Always on</Text>
      ) : (
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ true: Colors.primary, false: Colors.surfaceContainerHigh }}
          thumbColor={Colors.white}
          ios_backgroundColor={Colors.surfaceContainerHigh}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  body: { flex: 1 },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  locked: { ...Typography.labelMd, color: Colors.teal },
});
