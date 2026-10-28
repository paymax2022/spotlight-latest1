import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

/** YYYY-MM-DD in the device's local calendar (toISOString would shift a local date to UTC). */
export function localIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Tap-to-select range: the first tap starts a range, the next tap on a later day ends it.
 * A tap on or before the start restarts the range from that day.
 */
export function pickRange(start: string | null, end: string | null, iso: string): { start: string; end: string | null } {
  if (!start || (start && end)) return { start: iso, end: null };
  if (iso <= start) return { start: iso, end: null };
  return { start, end: iso };
}

/** A lightweight 3-month day-range calendar (no native calendar dependency). */
export default function DateRangeCalendar({
  start, end, onPick, months: monthCount = 3,
}: {
  start: string | null;
  end: string | null;
  onPick: (iso: string) => void;
  months?: number;
}) {
  const months = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    return Array.from({ length: monthCount }, (_, m) => new Date(base.getFullYear(), base.getMonth() + m, 1));
  }, [monthCount]);

  const today = localIso(new Date());
  const inRange = (iso: string): boolean => !!start && !!end && iso > start && iso < end;

  return (
    <View>
      {months.map((m, mi) => (
        <Month key={mi} month={m} today={today} start={start} end={end} inRange={inRange} onPick={onPick} />
      ))}
    </View>
  );
}

function Month({
  month, today, start, end, inRange, onPick,
}: {
  month: Date; today: string; start: string | null; end: string | null;
  inRange: (iso: string) => boolean; onPick: (iso: string) => void;
}) {
  const year = month.getFullYear();
  const mon = month.getMonth();
  const first = new Date(year, mon, 1).getDay();
  const days = new Date(year, mon + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(localIso(new Date(year, mon, d)));

  return (
    <View style={styles.month}>
      <Text style={styles.monthTitle}>{month.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })}</Text>
      <View style={styles.weekHead}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Text key={i} style={styles.weekHeadText}>{d}</Text>)}
      </View>
      <View style={styles.grid}>
        {cells.map((iso, i) => {
          if (!iso) return <View key={i} style={styles.cell} />;
          const past = iso < today;
          const isStart = iso === start;
          const isEnd = iso === end;
          const within = inRange(iso);
          return (
            <Pressable key={i} style={styles.cell} disabled={past} onPress={() => onPick(iso)}>
              <View style={[styles.day, within && styles.dayRange, (isStart || isEnd) && styles.dayEdge]}>
                <Text style={[styles.dayText, past && styles.dayPast, (isStart || isEnd) && styles.dayEdgeText]}>
                  {Number(iso.slice(-2))}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  month: { marginTop: 16 },
  monthTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: 8 },
  weekHead: { flexDirection: 'row' },
  weekHeadText: { flex: 1, textAlign: 'center', ...Typography.labelSm, color: Colors.onSurfaceVariant },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  day: { width: 38, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  dayRange: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: 0, width: '100%' },
  dayEdge: { backgroundColor: Colors.primary },
  dayText: { ...Typography.bodyMd, color: Colors.onSurface },
  dayPast: { color: Colors.outlineVariant },
  dayEdgeText: { color: Colors.onPrimary, fontWeight: '700' as const },
});
