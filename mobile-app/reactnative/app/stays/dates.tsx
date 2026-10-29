import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import DateRangeCalendar, { pickRange } from '@/features/stays/components/DateRangeCalendar';
import { useStaysStore } from '@/features/stays/store';
import { formatShortDate, nightsBetween } from '@/features/stays/constants/stays.constants';

export default function DatesScreen() {
  const { query, setQuery } = useStaysStore();
  const [start, setStart] = useState<string | null>(query.checkIn);
  const [end, setEnd] = useState<string | null>(query.checkOut);

  const onPick = (iso: string) => {
    const next = pickRange(start, end, iso);
    setStart(next.start);
    setEnd(next.end);
  };

  const nights = start && end ? nightsBetween(start, end) : 0;

  const apply = () => {
    if (start && end) {
      setQuery({ checkIn: start, checkOut: end });
      goBack('/stays');
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
        <DateRangeCalendar start={start} end={end} onPick={onPick} />
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  summary: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm },
  summaryDiv: { width: 1, height: 34, backgroundColor: Colors.outlineVariant, marginHorizontal: Spacing.md },
  sumLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sumValue: { ...Typography.titleMd, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
