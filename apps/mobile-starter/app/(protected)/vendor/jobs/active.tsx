// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const FILTERS = ['All', 'Accepted', 'In Progress', 'Awaiting Confirmation'];
const JOBS = [
  { id: '1', title: 'Electrical panel repair', estate: 'Green Estate', status: 'In Progress', due: 'Dec 18' },
  { id: '2', title: 'Install security lights', estate: 'Palm View', status: 'Accepted', due: 'Dec 20' },
];
const statusColor = (s: string) => {
  if (s === 'In Progress') return colors.secondary.DEFAULT;
  if (s === 'Accepted') return colors.secondary.emerald;
  return colors.secondary.amber;
};

export default function ActiveJobs() {
  const router = useRouter();
  const [filter, setFilter] = useState('All');
  const filtered = JOBS.filter(j => filter === 'All' || j.status === filter);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Active Jobs</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {FILTERS.map(f => (
          <Pressable key={f} style={[styles.filterChip, filter === f && styles.filterChipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>{f}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/vendor/jobs/${item.id}` as never)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{item.title}</Text>
              <Text style={styles.listSub}>{item.estate}</Text>
              <Text style={styles.dueText}>Due: {item.due}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <View style={[styles.badge, { backgroundColor: statusColor(item.status) + '20' }]}>
                <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>{item.status}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="briefcase-outline" size={40} color={colors.neutral.placeholder} />
            <Text style={styles.emptyText}>No jobs in this category</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  filterBar: { maxHeight: 50, paddingVertical: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.neutral.surface, borderWidth: 1, borderColor: colors.neutral.border },
  filterChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  filterChipText: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },
  listContent: { padding: 16 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.04, elevation: 1 },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  dueText: { fontSize: 12, color: colors.secondary.amber, marginTop: 2, fontWeight: '600' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
