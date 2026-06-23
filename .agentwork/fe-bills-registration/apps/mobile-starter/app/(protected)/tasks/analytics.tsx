// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listTasks } from '@/api/tasks.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function TaskAnalytics() {
  const router = useRouter();
  const { estateId } = getActiveEstateContext();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks', estateId, 'all'],
    queryFn: () => listTasks(estateId),
    staleTime: 30_000,
  });

  const stats = useMemo(() => {
    const all = tasks ?? [];
    const total = all.length;
    const done = all.filter(t => t.status === 'done').length;
    const overdue = all.filter(t => t.status === 'overdue').length;
    const inProgress = all.filter(t => t.status === 'in_progress').length;
    const rate = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, overdue, inProgress, rate };
  }, [tasks]);

  const weekBars = [
    { label: 'Mon', value: 3, color: colors.secondary.DEFAULT },
    { label: 'Tue', value: 5, color: colors.secondary.emerald },
    { label: 'Wed', value: 2, color: colors.secondary.amber },
    { label: 'Thu', value: 7, color: colors.secondary.DEFAULT },
    { label: 'Fri', value: 4, color: colors.secondary.emerald },
    { label: 'Sat', value: 1, color: colors.neutral.border },
    { label: 'Sun', value: 0, color: colors.neutral.border },
  ];
  const maxBar = Math.max(...weekBars.map(b => b.value), 1);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Task Analytics</Text>
        <View style={{ width: 38 }} />
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.DEFAULT} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Completion Rate</Text>
            <View style={styles.donutWrap}>
              <View style={styles.donut}>
                <Text style={styles.donutPct}>{stats.rate}%</Text>
                <Text style={styles.donutLabel}>Complete</Text>
              </View>
            </View>
          </View>

          <View style={styles.summaryGrid}>
            {[
              { label: 'Total Tasks', value: stats.total, color: colors.neutral.text },
              { label: 'Completed', value: stats.done, color: colors.secondary.emerald },
              { label: 'In Progress', value: stats.inProgress, color: colors.secondary.amber },
              { label: 'Overdue', value: stats.overdue, color: colors.secondary.red },
            ].map(s => (
              <View key={s.label} style={styles.summaryCard}>
                <Text style={[styles.summaryNum, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.summaryLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tasks This Week</Text>
            <View style={styles.barChart}>
              {weekBars.map(bar => (
                <View key={bar.label} style={styles.barCol}>
                  <Text style={styles.barValue}>{bar.value}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.bar, { height: (bar.value / maxBar) * 100, backgroundColor: bar.color }]} />
                  </View>
                  <Text style={styles.barLabel}>{bar.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, marginBottom: 16 },
  donutWrap: { alignItems: 'center', paddingVertical: 10 },
  donut: { width: 140, height: 140, borderRadius: 70, borderWidth: 16, borderColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center', borderLeftColor: colors.neutral.border, borderBottomColor: colors.neutral.border },
  donutPct: { fontSize: 28, fontWeight: '800', color: colors.primary.DEFAULT },
  donutLabel: { fontSize: 12, color: colors.neutral.textMuted },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryCard: { flex: 1, minWidth: '45%', backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  summaryNum: { fontSize: 28, fontWeight: '800' },
  summaryLabel: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 130 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barValue: { fontSize: 11, fontWeight: '600', color: colors.neutral.textMuted },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 4, minHeight: 4 },
  barLabel: { fontSize: 10, color: colors.neutral.textMuted },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
