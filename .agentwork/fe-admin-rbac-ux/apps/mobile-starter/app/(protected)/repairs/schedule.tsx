// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FILTERS = ['Upcoming', 'Overdue', 'Completed'];

function buildCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

export default function MaintenanceScheduleScreen() {
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [filter, setFilter] = useState('Upcoming');

  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });
  const estateId = ctx?.estateId ?? '';

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['maintenance-schedule', estateId, year, month],
    queryFn: async () => {
      if (!estateId) return [];
      const res = await fetch(`/api/estates/${estateId}/maintenance?year=${year}&month=${month + 1}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!estateId,
  });

  const events = data ?? [];
  const cells = buildCalendarDays(year, month);
  const eventDays = new Set(events.map((e) => new Date(e.date).getDate()));
  const selectedEvents = events.filter((e) => new Date(e.date).getDate() === selectedDay);
  const filteredEvents = selectedEvents.filter((e) => {
    if (filter === 'Upcoming') return e.status === 'upcoming';
    if (filter === 'Overdue') return e.status === 'overdue';
    return e.status === 'completed';
  });

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Maintenance Schedule</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}>
        {/* Month navigator */}
        <View style={s.monthNav}>
          <Pressable style={s.navBtn} onPress={prevMonth}><Ionicons name="chevron-back" size={20} color={colors.primary.DEFAULT} /></Pressable>
          <Text style={s.monthLabel}>{monthNames[month]} {year}</Text>
          <Pressable style={s.navBtn} onPress={nextMonth}><Ionicons name="chevron-forward" size={20} color={colors.primary.DEFAULT} /></Pressable>
        </View>

        {/* Calendar grid */}
        <View style={s.calCard}>
          <View style={s.dayHeaders}>
            {DAYS.map((d) => <Text key={d} style={s.dayHeader}>{d}</Text>)}
          </View>
          <View style={s.calGrid}>
            {cells.map((day, i) => (
              <Pressable key={i} style={[s.calCell, day === selectedDay && s.calCellActive, !day && { opacity: 0 }]} onPress={() => day && setSelectedDay(day)}>
                <Text style={[s.calDayTxt, day === selectedDay && s.calDayTxtActive]}>{day ?? ''}</Text>
                {day && eventDays.has(day) && <View style={[s.eventDot, day === selectedDay && { backgroundColor: '#fff' }]} />}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Filters */}
        <View style={s.filterRow}>
          {FILTERS.map((f) => (
            <Pressable key={f} style={[s.filterChip, filter === f && s.filterChipActive]} onPress={() => setFilter(f)}>
              <Text style={[s.filterTxt, filter === f && s.filterTxtActive]}>{f}</Text>
            </Pressable>
          ))}
        </View>

        {/* Events list */}
        <Text style={s.sectionLabel}>{monthNames[month]} {selectedDay} — Events</Text>
        {isLoading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} />
        ) : filteredEvents.length === 0 ? (
          <View style={s.empty}><Ionicons name="calendar-outline" size={40} color={colors.neutral.placeholder} /><Text style={s.emptyTxt}>No events for this day</Text></View>
        ) : (
          filteredEvents.map((ev, i) => (
            <View key={i} style={s.evCard}>
              <View style={s.evLeft}><Ionicons name="construct-outline" size={20} color={colors.primary.DEFAULT} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.evTitle}>{ev.title}</Text>
                <Text style={s.evSub}>{ev.time ?? 'All day'} · {ev.location}</Text>
              </View>
              <View style={[s.badge, { backgroundColor: ev.status === 'completed' ? '#dcfce7' : ev.status === 'overdue' ? '#fee2e2' : '#dbeafe' }]}>
                <Text style={[s.badgeTxt, { color: ev.status === 'completed' ? '#166534' : ev.status === 'overdue' ? '#991b1b' : '#1d4ed8' }]}>{ev.status}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.neutral.surface, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  monthLabel: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  calCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  dayHeaders: { flexDirection: 'row', marginBottom: 8 },
  dayHeader: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: colors.neutral.textMuted },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  calCellActive: { backgroundColor: colors.primary.DEFAULT },
  calDayTxt: { fontSize: 13, color: colors.neutral.text },
  calDayTxtActive: { color: '#fff', fontWeight: '700' },
  eventDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary.DEFAULT, marginTop: 2 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.neutral.surface, borderWidth: 1, borderColor: colors.neutral.border },
  filterChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  filterTxt: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '500' },
  filterTxtActive: { color: '#fff', fontWeight: '700' },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  evCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  evLeft: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  evTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  evSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeTxt: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  emptyTxt: { fontSize: 14, color: colors.neutral.textMuted },
});
