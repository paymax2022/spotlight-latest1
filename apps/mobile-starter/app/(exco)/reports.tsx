// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

type Stat = { label: string; value: string | number; icon: string; color: string; sub?: string };

const DEFAULT_STATS: Stat[] = [
  { label: 'Meetings This Month', value: '--', icon: 'calendar-outline',         color: colors.secondary.DEFAULT },
  { label: 'Active Elections',    value: '--', icon: 'podium-outline',            color: colors.primary.DEFAULT },
  { label: 'Open Tasks',          value: '--', icon: 'checkmark-circle-outline',  color: colors.secondary.amber },
  { label: 'Announcements Sent',  value: '--', icon: 'megaphone-outline',         color: '#7c3aed' },
  { label: 'Total Residents',     value: '--', icon: 'people-outline',            color: colors.secondary.emerald },
];

export default function ExcoReports() {
  const router = useRouter();
  const [stats, setStats] = useState<Stat[]>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/estate/analytics/summary')
      .then(r => r.json())
      .then(d => {
        const data = d.data ?? d;
        setStats([
          { label: 'Meetings This Month', value: data.meetings_this_month ?? '--', icon: 'calendar-outline',         color: colors.secondary.DEFAULT, sub: 'this month' },
          { label: 'Active Elections',    value: data.active_elections ?? '--',    icon: 'podium-outline',            color: colors.primary.DEFAULT,   sub: 'in progress' },
          { label: 'Open Tasks',          value: data.open_tasks ?? '--',          icon: 'checkmark-circle-outline',  color: colors.secondary.amber,   sub: 'pending' },
          { label: 'Announcements Sent',  value: data.announcements_sent ?? '--',  icon: 'megaphone-outline',         color: '#7c3aed',                sub: 'total' },
          { label: 'Total Residents',     value: data.residents_count ?? '--',     icon: 'people-outline',            color: colors.secondary.emerald, sub: 'registered' },
        ]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Reports</Text>
        <Pressable style={s.analyticsBtn} onPress={() => router.push('/analytics' as never)}>
          <Text style={s.analyticsBtnText}>Full Analytics</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.primary.DEFAULT} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Text style={s.sectionLabel}>Estate Summary</Text>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={colors.primary.DEFAULT} /></View>
        ) : (
          <View style={s.statsGrid}>
            {stats.map(stat => (
              <View key={stat.label} style={s.statCard}>
                <View style={[s.statIcon, { backgroundColor: `${stat.color}18` }]}>
                  <Ionicons name={stat.icon as any} size={22} color={stat.color} />
                </View>
                <Text style={s.statValue}>{stat.value}</Text>
                <Text style={s.statLabel}>{stat.label}</Text>
                {stat.sub && <Text style={s.statSub}>{stat.sub}</Text>}
              </View>
            ))}
          </View>
        )}

        <Pressable style={s.fullReportBtn} onPress={() => router.push('/analytics' as never)}>
          <Ionicons name="bar-chart-outline" size={18} color="#fff" />
          <Text style={s.fullReportBtnText}>View Full Analytics Dashboard</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.neutral.text },
  analyticsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  analyticsBtnText: { fontSize: 13, color: colors.primary.DEFAULT, fontWeight: '600' },
  body: { padding: 16, paddingBottom: 40 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.neutral.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 14 },
  center: { paddingTop: 40, alignItems: 'center' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  statCard: { width: '47%', backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16, alignItems: 'flex-start', borderWidth: 1, borderColor: colors.neutral.border },
  statIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  statValue: { fontSize: 26, fontWeight: '700', color: colors.neutral.text, marginBottom: 2 },
  statLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600', lineHeight: 17 },
  statSub: { fontSize: 11, color: colors.neutral.placeholder, marginTop: 2 },
  fullReportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 16 },
  fullReportBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
