import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import SelectField from '@/components/SelectField';

// Builds a recurrence rule string like "MON,WED,FRI 07:00-18:00" (VM-105).
const DAYS = [
  { key: 'MON', label: 'M' },
  { key: 'TUE', label: 'T' },
  { key: 'WED', label: 'W' },
  { key: 'THU', label: 'T' },
  { key: 'FRI', label: 'F' },
  { key: 'SAT', label: 'S' },
  { key: 'SUN', label: 'S' },
];

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

export function buildRecurrenceRule(days: string[], start: string, end: string): string | undefined {
  if (days.length === 0) return undefined;
  const ordered = DAYS.filter((d) => days.includes(d.key)).map((d) => d.key);
  return `${ordered.join(',')} ${start}-${end}`;
}

interface Props {
  onChange: (rule: string | undefined) => void;
}

/** Day-of-week + time-window picker for recurring / domestic-staff codes. */
export default function RecurrenceEditor({ onChange }: Props) {
  const [days, setDays] = useState<string[]>(['MON', 'TUE', 'WED', 'THU', 'FRI']);
  const [start, setStart] = useState('07:00');
  const [end, setEnd] = useState('18:00');

  const rule = useMemo(() => buildRecurrenceRule(days, start, end), [days, start, end]);

  // Emit on every change so the parent always has the current rule.
  React.useEffect(() => { onChange(rule); }, [rule]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDay = (key: string) =>
    setDays((d) => (d.includes(key) ? d.filter((x) => x !== key) : [...d, key]));

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Repeats on</Text>
      <View style={styles.dayRow}>
        {DAYS.map((d, i) => {
          const selected = days.includes(d.key);
          return (
            <Pressable
              key={`${d.key}-${i}`}
              onPress={() => toggleDay(d.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={d.key}
              style={[styles.day, selected && styles.daySelected]}
            >
              <Text style={[styles.dayText, selected && styles.dayTextSelected]}>{d.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.timeRow}>
        <View style={styles.timeCol}>
          <SelectField label="From" value={start} options={HOURS} onChange={setStart} searchable />
        </View>
        <View style={styles.timeCol}>
          <SelectField label="To" value={end} options={HOURS} onChange={setEnd} searchable />
        </View>
      </View>

      <Text style={styles.summary}>{rule ? `Schedule: ${rule}` : 'Pick at least one day'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  dayRow: { flexDirection: 'row', gap: Spacing.sm },
  day: {
    width: 38, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent,
  },
  daySelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  dayTextSelected: { color: Colors.onPrimary },
  timeRow: { flexDirection: 'row', gap: Spacing.md },
  timeCol: { flex: 1 },
  summary: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
