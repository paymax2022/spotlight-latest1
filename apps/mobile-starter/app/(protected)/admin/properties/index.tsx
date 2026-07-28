// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const FILTERS = ['All', 'Occupied', 'Vacant', 'Pending'];
const PROPERTIES = [
  { id: '1', unit: 'A1', type: 'Apartment', occupant: 'James Okafor', status: 'Occupied' },
  { id: '2', unit: 'A2', type: 'Apartment', occupant: '', status: 'Vacant' },
  { id: '3', unit: 'B5', type: 'Duplex', occupant: 'Amaka Eze', status: 'Occupied' },
  { id: '4', unit: 'C10', type: 'Shop', occupant: 'Pending Review', status: 'Pending' },
  { id: '5', unit: 'D3', type: 'Bungalow', occupant: '', status: 'Vacant' },
];

const statusColor = (s: string) => {
  if (s === 'Occupied') return colors.secondary.emerald;
  if (s === 'Vacant') return colors.secondary.DEFAULT;
  if (s === 'Pending') return colors.secondary.amber;
  return colors.neutral.textMuted;
};

export default function PropertiesList() {
  const router = useRouter();
  const [filter, setFilter] = useState('All');
  const filtered = PROPERTIES.filter(p => filter === 'All' || p.status === filter);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Properties</Text>
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
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/admin/properties/${item.id}` as never)}>
            <View style={styles.unitBadge}>
              <Text style={styles.unitText}>{item.unit}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{item.type}</Text>
              <Text style={styles.listSub}>{item.occupant || 'No occupant'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <View style={[styles.badge, { backgroundColor: statusColor(item.status) + '20' }]}>
                <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>{item.status}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
            </View>
          </Pressable>
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  unitBadge: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  unitText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
});
