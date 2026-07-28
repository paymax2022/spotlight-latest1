import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Circle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import { useAttendees } from '@/features/events/hooks';
import { EventColors } from '@/features/events/constants/events.constants';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'checked-in', label: 'Checked in' },
  { value: 'pending', label: 'Pending' },
] as const;

export default function Attendees() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { data, isLoading, isError, refetch } = useAttendees(eventId ?? '');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'checked-in' | 'pending'>('all');

  const list = useMemo(() => {
    let arr = data ?? [];
    if (filter === 'checked-in') arr = arr.filter((a) => a.checkedIn);
    if (filter === 'pending') arr = arr.filter((a) => !a.checkedIn);
    if (q.trim()) {
      const s = q.toLowerCase();
      arr = arr.filter((a) => a.name.toLowerCase().includes(s) || a.cashtag.toLowerCase().includes(s));
    }
    return arr;
  }, [data, filter, q]);

  const checkedIn = (data ?? []).filter((a) => a.checkedIn).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Attendees" subtitle={data ? `${checkedIn}/${data.length} checked in` : undefined} />
      <SearchBar placeholder="Search by name or cashtag…" value={q} onChangeText={setQ} />
      <View style={{ marginBottom: Spacing.md }}>
        <SegmentedControl options={FILTERS as any} value={filter} onChange={setFilter} />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading attendees…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load attendees" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : list.length === 0 ? (
        <StateView kind="empty" title="No attendees" message="No one matches this filter yet." icon="Users" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {list.map((a) => (
            <View key={a.id} style={styles.row}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{a.name.charAt(0)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{a.name}</Text>
                <Text style={styles.sub}>{a.cashtag} · {a.tierName}</Text>
              </View>
              {a.checkedIn ? (
                <View style={styles.statusIn}><CheckCircle2 size={18} color={EventColors.ok} /><Text style={styles.statusInText}>In</Text></View>
              ) : (
                <View style={styles.statusOut}><Circle size={18} color={EventColors.muted} /><Text style={styles.statusOutText}>Pending</Text></View>
              )}
            </View>
          ))}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  avatar: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: EventColors.brand },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: EventColors.muted, marginTop: 2 },
  statusIn: { alignItems: 'center', gap: 2 },
  statusInText: { ...Typography.caption, color: EventColors.ok },
  statusOut: { alignItems: 'center', gap: 2 },
  statusOutText: { ...Typography.caption, color: EventColors.muted },
});
