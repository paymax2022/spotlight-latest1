// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const CATEGORIES = ['All', 'Payments', 'Security', 'Admin', 'System'];
const LOGS = [
  { id: '1', icon: 'card', cat: 'Payments', action: 'Payment recorded for Unit B12', actor: 'Admin', time: '2024-12-15 09:42' },
  { id: '2', icon: 'shield-checkmark', cat: 'Security', action: 'Gate override activated at Gate A', actor: 'Guard Ade', time: '2024-12-15 08:30' },
  { id: '3', icon: 'person', cat: 'Admin', action: 'Resident Amaka Eze approved', actor: 'Admin', time: '2024-12-14 17:00' },
  { id: '4', icon: 'settings', cat: 'System', action: 'Visitor rules updated', actor: 'Admin', time: '2024-12-14 14:22' },
  { id: '5', icon: 'ban', cat: 'Admin', action: 'Resident Tunde suspended', actor: 'Admin', time: '2024-12-13 11:05' },
];

const catColor = (c: string) => {
  if (c === 'Payments') return colors.secondary.emerald;
  if (c === 'Security') return colors.secondary.red;
  if (c === 'Admin') return colors.primary.DEFAULT;
  return colors.secondary.DEFAULT;
};

export default function AuditLogs() {
  const router = useRouter();
  const [category, setCategory] = useState('All');
  const filtered = LOGS.filter(l => category === 'All' || l.cat === category);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Audit Logs</Text>
        <Pressable style={styles.backBtn}>
          <Ionicons name="download-outline" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {CATEGORIES.map(c => (
          <Pressable key={c} style={[styles.filterChip, category === c && styles.filterChipActive]} onPress={() => setCategory(c)}>
            <Text style={[styles.filterChipText, category === c && styles.filterChipTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }) => (
          <View style={[styles.logRow, index < filtered.length - 1 && styles.listBorder]}>
            <View style={[styles.logIcon, { backgroundColor: catColor(item.cat) + '20' }]}>
              <Ionicons name={item.icon as any} size={16} color={catColor(item.cat)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{item.action}</Text>
              <Text style={styles.listSub}>{item.actor} · {item.time}</Text>
            </View>
          </View>
        )}
        ListHeaderComponent={<View style={styles.card} />}
        ListFooterComponent={<View style={{ height: 20 }} />}
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
  listContent: { paddingHorizontal: 16 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, elevation: 2 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.neutral.surface },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  logIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 11, color: colors.neutral.textMuted, marginTop: 2 },
});
