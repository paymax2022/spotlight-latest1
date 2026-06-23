// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listTasks } from '@/api/tasks.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const priorityColors = { low: colors.secondary.DEFAULT, medium: colors.secondary.amber, high: colors.secondary.red };

export default function TaskCalendar() {
  const router = useRouter();
  const { estateId } = getActiveEstateContext();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const { data: tasks } = useQuery({
    queryKey: ['tasks', estateId, 'all'],
    queryFn: () => listTasks(estateId),
    staleTime: 30_000,
  });

  const taskDayMap = useMemo(() => {
    const map = new Map<number, string>();
    (tasks ?? []).forEach(t => {
      if (!t.due_date) return;
      const d = new Date(t.due_date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const existing = map.get(d.getDate());
        if (!existing || (t.priority === 'high' && existing !== 'high')) map.set(d.getDate(), t.priority);
      }
    });
    return map;
  }, [tasks, year, month]);

  const selectedTasks = useMemo(() => {
    if (!selectedDay) return [];
    return (tasks ?? []).filter(t => {
      if (!t.due_date) return false;
      const d = new Date(t.due_date);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === selectedDay;
    });
  }, [tasks, year, month, selectedDay]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); setSelectedDay(null); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); setSelectedDay(null); };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Task Calendar</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.calCard}>
          <View style={styles.navRow}>
            <Pressable style={styles.navBtn} onPress={prevMonth}><Ionicons name="chevron-back" size={20} color={colors.primary.DEFAULT} /></Pressable>
            <Text style={styles.monthTitle}>{MONTHS[month]} {year}</Text>
            <Pressable style={styles.navBtn} onPress={nextMonth}><Ionicons name="chevron-forward" size={20} color={colors.primary.DEFAULT} /></Pressable>
          </View>
          <View style={styles.weekRow}>
            {DAYS.map(d => <Text key={d} style={styles.dayLabel}>{d}</Text>)}
          </View>
          {Array.from({ length: cells.length / 7 }, (_, row) => (
            <View key={row} style={styles.weekRow}>
              {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
                const dotColor = day ? priorityColors[taskDayMap.get(day) ?? ''] : null;
                return (
                  <Pressable key={col} style={[styles.dayCell, day && selectedDay === day && styles.dayCellSelected, !day && { opacity: 0 }]} onPress={() => day && setSelectedDay(day)} disabled={!day}>
                    <Text style={[styles.dayNum, day && selectedDay === day && { color: '#fff' }]}>{day ?? ''}</Text>
                    {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }, selectedDay === day && { backgroundColor: '#fff' }]} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {selectedDay ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{MONTHS[month]} {selectedDay}</Text>
            {selectedTasks.length === 0 ? (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>No tasks due on this day</Text></View>
            ) : selectedTasks.map(t => (
              <Pressable key={t.id} style={styles.taskCard} onPress={() => router.push(`/tasks/${t.id}` as never)}>
                <View style={[styles.priorityBar, { backgroundColor: priorityColors[t.priority] }]} />
                <View style={styles.taskInfo}>
                  <Text style={styles.taskTitle}>{t.title}</Text>
                  <Text style={styles.taskSub}>{t.priority} priority · {t.status.replace('_', ' ')}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  calCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  weekRow: { flexDirection: 'row' },
  dayLabel: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600', color: colors.neutral.textMuted, paddingVertical: 6 },
  dayCell: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8 },
  dayCellSelected: { backgroundColor: colors.primary.DEFAULT },
  dayNum: { fontSize: 14, fontWeight: '500', color: colors.neutral.text },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  taskCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, flexDirection: 'row', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  priorityBar: { width: 5 },
  taskInfo: { flex: 1, padding: 14 },
  taskTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  taskSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2, textTransform: 'capitalize' },
});
