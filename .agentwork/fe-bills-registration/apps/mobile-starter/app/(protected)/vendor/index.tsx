// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const TABS = ['Available', 'My Jobs'];
const AVAILABLE_JOBS = [
  { id: '1', title: 'Fix leaking roof', estate: 'Green Estate', urgency: 'High', value: 45000, time: '2h ago' },
  { id: '2', title: 'Electrical repair', estate: 'Green Estate', urgency: 'Medium', value: 30000, time: '5h ago' },
  { id: '3', title: 'Plumbing maintenance', estate: 'Sunrise Estate', urgency: 'Low', value: 20000, time: '1d ago' },
];
const urgencyColor = (u: string) => u === 'High' ? colors.secondary.red : u === 'Medium' ? colors.secondary.amber : colors.secondary.emerald;

export default function VendorDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState('Available');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Vendor Portal</Text>
        <Pressable style={styles.backBtn} onPress={() => router.push('/vendor/profile' as never)}>
          <Ionicons name="person-circle-outline" size={22} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statsRow}>
          {[
            { label: 'Available', value: '12', icon: 'briefcase' },
            { label: 'Active', value: '2', icon: 'construct' },
            { label: 'Completed', value: '8', icon: 'checkmark-done' },
          ].map((s, i) => (
            <View key={i} style={styles.statCard}>
              <Ionicons name={s.icon as any} size={18} color={colors.primary.DEFAULT} />
              <Text style={styles.statNum}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.earningsCard}>
          <View>
            <Text style={styles.earningsLabel}>This Week</Text>
            <Text style={styles.earningsAmount}>₦75,000</Text>
          </View>
          <View>
            <Text style={styles.earningsLabel}>Today</Text>
            <Text style={styles.earningsAmount}>₦30,000</Text>
          </View>
          <View style={styles.ratingWrap}>
            <Ionicons name="star" size={16} color="#C5A059" />
            <Text style={styles.ratingText}>4.8</Text>
          </View>
        </View>

        <View style={styles.tabRow}>
          {TABS.map(t => (
            <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'Available' && AVAILABLE_JOBS.slice(0, 3).map((job, i) => (
          <Pressable key={job.id} style={styles.jobCard} onPress={() => router.push(`/vendor/jobs/${job.id}` as never)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.jobTitle}>{job.title}</Text>
              <Text style={styles.jobSub}>{job.estate} · {job.time}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <View style={[styles.badge, { backgroundColor: urgencyColor(job.urgency) + '20' }]}>
                <Text style={[styles.badgeText, { color: urgencyColor(job.urgency) }]}>{job.urgency}</Text>
              </View>
              <Text style={styles.jobValue}>₦{job.value.toLocaleString()}</Text>
            </View>
          </Pressable>
        ))}

        {tab === 'My Jobs' && (
          <View style={styles.emptyCard}>
            <Ionicons name="construct-outline" size={40} color={colors.neutral.placeholder} />
            <Text style={styles.emptyText}>No active jobs yet</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 14 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 12, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOpacity: 0.04, elevation: 1 },
  statNum: { fontSize: 20, fontWeight: '800', color: colors.neutral.text },
  statLabel: { fontSize: 11, color: colors.neutral.textMuted },
  earningsCard: { backgroundColor: colors.primary.DEFAULT, borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  earningsLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  earningsAmount: { fontSize: 18, fontWeight: '800', color: '#fff' },
  ratingWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  ratingText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  tabRow: { flexDirection: 'row', backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: colors.neutral.surface, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.neutral.textMuted },
  tabTextActive: { color: colors.primary.DEFAULT },
  jobCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.04, elevation: 1 },
  jobTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  jobSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  jobValue: { fontSize: 14, fontWeight: '800', color: colors.secondary.emerald },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
