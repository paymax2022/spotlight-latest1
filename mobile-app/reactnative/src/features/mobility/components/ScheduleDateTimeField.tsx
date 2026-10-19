import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import DatePickerField from '@/components/DatePickerField';
import TimePickerField from '@/components/TimePickerField';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { combineLocal, localDate, localTime } from '../utils/scheduleTime';

interface Props {
  label: string;
  /** ISO instant, or '' when nothing has been chosen yet. */
  value: string;
  onChange: (iso: string) => void;
  error?: string | null;
}

// A date and a time in the device's calendar, written back as one ISO instant.
// Picking only a date keeps a sensible time (09:00) rather than dropping the date.
export default function ScheduleDateTimeField({ label, value, onChange, error }: Props) {
  const date = value ? localDate(value) : undefined;
  const time = value ? localTime(value) : undefined;
  const now = new Date();
  const currentYear = now.getFullYear();

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <View style={styles.cell}>
          <DatePickerField
            label="Date"
            value={date}
            minYear={currentYear}
            maxYear={currentYear + 1}
            onChange={(d) => onChange(combineLocal(d, time ?? '09:00'))}
          />
        </View>
        <View style={styles.cell}>
          <TimePickerField
            label="Time"
            value={time}
            onChange={(t) => onChange(combineLocal(date ?? localDate(now.toISOString()), t))}
          />
        </View>
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  row: { flexDirection: 'row', gap: Spacing.sm },
  cell: { flex: 1 },
  error: { ...Typography.labelSm, color: Colors.error },
});
