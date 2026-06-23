// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const CATEGORIES = ['All', 'Electrical', 'Plumbing', 'Carpentry', 'Painting', 'General'];
const JOBS = [
  { id: '1', cat: 'Electrical', title: 'Fix leaking roof', estate: 'Green Estate', urgency: 'High', value: 45000, time: '2h ago' },
  { id: '2', cat: 'Plumbing', title: 'Blocked drain repair', estate: 'Sunrise Estate', urgency: 'Medium', value: 25000, time: '4h ago' },
  { id: '3', cat: 'Carpentry', title: 'Fix broken door', estate: 'Green Estate', urgency: 'Low', value: 15000, time: '6h ago' },
  { id: '4', cat: 'Painting', title: 'Repaint 3-bedroom apt', estate: 'Palm View', urgency: 'Low', value: 80000, time: '1d ago' },
];
const urgencyColor = (u: string) => u === 'High' ? colors.secondary.red : u === 'Medium' ? colors.secondary.amber : colors.secondary.emerald;

export default function AvailableJobs() {
  const router = useRouter();
  const [cat, setCat] = useState('All');
  const filtered = JOBS.filter(j => cat === 'All' || j.cat === cat);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Available Jobs</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {CATEGORIES.map(c => (
          <Pressable key={c} style={[styles.filterChip, cat === c && styles.filterChipActive]} onPress={() => setCat(c)}>
            <Text style={[styles.filterChipText, cat === c && styles.filterChipTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.catIcon}>
                <Ionicons name="construct" size={18} color={colors.primary.DEFAULT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{item.title}</Text>
                <Text style={styles.listSub}>{item.estate} · {item.time}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <View style={[styles.badge, { backgroundColor: urgencyColor(item.urgency) + '20' }]}>
                  <Text style={[styles.badgeText, { color: urgencyColor(item.urgency) }]}>{item.urgency}</Text>
                </View>
                <Text style={styles.valueText}>₦{item.value.toLocaleString()}</Text>
              </View>
            </View>
            <View style={styles.cardActions}>
              <Pressable style={styles.viewBtn} onPress={() => router.push(`/vendor/jobs/${item.id}` as never)}>
                <Text style={styles.viewBtnText}>View Details</Text>
              </Pressable>
              <Pressable style={styles.acceptBtn}>
                <Ionicons name="checkmark-circle" size={16} color="#fff" />
                <Text style={styles.acceptBtnText}>Accept Job</Text>
              </Pressable>
            </View>
          </View>
        )}
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, elevation: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14 },
  catIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  valueText: { fontSize: 14, fontWeight: '800', color: colors.secondary.emerald },
  cardActions: { flexDirection: 'row', gap: 10, padding: 14, paddingTop: 0 },
  viewBtn: { flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary.DEFAULT },
  viewBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary.DEFAULT },
  acceptBtn: { flex: 1, height: 40, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.secondary.emerald },
  acceptBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
