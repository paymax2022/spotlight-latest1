// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const FILTERS = ['All', 'Active', 'Pending', 'Suspended', 'Banned'];
const RESIDENTS = [
  { id: '1', name: 'Adaeze Okonkwo', unit: 'B12', role: 'Homeowner', status: 'Active' },
  { id: '2', name: 'Emeka Nwosu', unit: 'A4', role: 'Tenant', status: 'Active' },
  { id: '3', name: 'Fatima Bello', unit: 'C7', role: 'Resident', status: 'Pending' },
  { id: '4', name: 'Tunde Adeyemi', unit: 'D3', role: 'Homeowner', status: 'Suspended' },
  { id: '5', name: 'Ngozi Eze', unit: 'A9', role: 'Tenant', status: 'Active' },
];

const statusColor = (s: string) => {
  if (s === 'Active') return colors.secondary.emerald;
  if (s === 'Pending') return colors.secondary.amber;
  if (s === 'Suspended') return colors.secondary.red;
  if (s === 'Banned') return '#6b7280';
  return colors.neutral.textMuted;
};
const roleColor = (r: string) => {
  if (r === 'Homeowner') return colors.primary.DEFAULT;
  if (r === 'Tenant') return colors.secondary.DEFAULT;
  return colors.neutral.textMuted;
};

export default function ResidentsList() {
  const router = useRouter();
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');

  const filtered = RESIDENTS.filter(r =>
    (filter === 'All' || r.status === filter) &&
    (r.name.toLowerCase().includes(search.toLowerCase()) || r.unit.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Residents</Text>
        <Pressable style={styles.backBtn} onPress={() => {}}>
          <Ionicons name="person-add" size={20} color="#fff" />
        </Pressable>
      </View>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.neutral.placeholder} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search residents..."
          placeholderTextColor={colors.neutral.placeholder}
          value={search}
          onChangeText={setSearch}
        />
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
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => (
          <Pressable style={styles.residentCard} onPress={() => router.push(`/admin/residents/${item.id}` as never)}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name.split(' ').map(n => n[0]).join('')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{item.name}</Text>
              <Text style={styles.listSub}>Unit {item.unit}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <View style={[styles.badge, { backgroundColor: roleColor(item.role) + '20' }]}>
                <Text style={[styles.badgeText, { color: roleColor(item.role) }]}>{item.role}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: statusColor(item.status) + '20' }]}>
                <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>{item.status}</Text>
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="people-outline" size={40} color={colors.neutral.placeholder} />
            <Text style={styles.emptyText}>No residents found</Text>
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', margin: 16, marginBottom: 8, backgroundColor: colors.neutral.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.neutral.border },
  searchInput: { flex: 1, fontSize: 14, color: colors.neutral.text },
  filterBar: { maxHeight: 44, marginBottom: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.neutral.surface, borderWidth: 1, borderColor: colors.neutral.border },
  filterChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  filterChipText: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },
  listContent: { padding: 16, paddingTop: 8 },
  residentCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary.DEFAULT + '20', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '700', color: colors.primary.DEFAULT },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 28, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
