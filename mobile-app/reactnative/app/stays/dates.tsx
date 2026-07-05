import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useStaysStore } from '@/features/stays/store';
import { formatShortDate, nightsBetween } from '@/features/stays/constants/stays.constants';

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A lightweight 2-month day-range picker (no native calendar dependency). */
export default function DatesScreen() {
  const { query, setQuery } = useStaysStore();
  const [start, setStart] = useState<string | null>(query.checkIn);
  const [end, setEnd] = useState<string | null>(query.checkOut);

  const months = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    return [0, 1, 2].map((m) => {
      const d = new Date(base.getFullYear(), base.getMonth() + m, 1);
      return d;
    });
  }, []);

  const today = isoOf(new Date());

  const onPick = (iso: string) => {
    if (!start || (start && end)) {
      setStart(iso);
      setEnd(null);
      return;
    }
    if (iso <= start) {
      setStart(iso);
      return;
    }
    setEnd(iso);
  };

  const inRange = (iso: string): boolean => !!start && !!end && iso > start && iso < end;
  const nights = start && end ? nightsBetween(start, end) : 0;

  const apply = () => {
    if (start && end) {
      setQuery({ checkIn: start, checkOut: end });
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Select dates" subtitle={start && end ? `${nights} night${nights > 1 ? 's' : ''}` : 'Tap check-in then check-out'} />

      <View style={styles.summary}>
        <SummaryCol label="Check-in" value={start ? formatShortDate(start) : '—'} />
        <View style={styles.summaryDiv} />
        <SummaryCol label="Check-out" value={end ? formatShortDate(end) : '—'} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {months.map((m, mi) => (
          <Month key={mi} month={m} today={today} start={start} end={end} inRange={inRange} onPick={onPick} />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={start && end ? `Apply · ${nights} night${nights > 1 ? 's' : ''}` : 'Select check-out date'} onPress={apply} disabled={!start || !end} />
      </View>
    </SafeAreaView>
  );
}

function SummaryCol({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={styles.sumValue}>{value}</Text>
    </View>
  );
}

function Month({
  month, today, start, end, inRange, onPick,
}: {
  month: Date; today: string; start: string | null; end: string | null;
  inRange: (iso: string) => boolean | null; onPick: (iso: string) => void;
}) {
  const year = month.getFullYear();
  const mon = month.getMonth();
  const first = new Date(year, mon, 1).getDay();
  const days = new Date(year, mon + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(isoOf(new Date(year, mon, d)));

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
              <View style={[
                styles.day,
                within && styles.dayRange,
                (isStart || isEnd) && styles.dayEdge,
              ]}>
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
  safe: { flex: 1, backgroundColor: Colors.background },
  summary: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm },
  summaryDiv: { width: 1, height: 34, backgroundColor: Colors.outlineVariant, marginHorizontal: Spacing.md },
  sumLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sumValue: { ...Typography.titleMd, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  month: { marginTop: Spacing.md },
  monthTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
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
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
