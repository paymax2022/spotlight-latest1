// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function GuardResidents() {
  const [residents, setResidents] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/estate/residents')
      .then(r => r.json())
      .then(d => { const list = d.data ?? d ?? []; setResidents(list); setFiltered(list); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(residents.filter(r => r.name?.toLowerCase().includes(q) || r.unit?.toLowerCase().includes(q)));
  }, [search, residents]);

  const AVATAR_COLORS = ['#340075', '#0051d5', '#059669'];
  const initials = (name: string) => (name ?? '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const avatarColor = (name: string) => AVATAR_COLORS[(name?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Residents</Text>
      </View>
      <View style={s.searchBar}>
        <Ionicons name="search-outline" size={18} color={colors.neutral.placeholder} />
        <TextInput style={s.searchInput} placeholder="Search by name or unit..." placeholderTextColor={colors.neutral.placeholder} value={search} onChangeText={setSearch} />
      </View>
      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#10B981" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, i) => item.id ?? String(i)}
          contentContainerStyle={s.listBody}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<View style={s.center}><Text style={s.emptyText}>No residents found</Text></View>}
          renderItem={({ item }) => (
            <View style={s.residentCard}>
              <View style={[s.avatar, { backgroundColor: avatarColor(item.name) }]}>
                <Text style={s.avatarText}>{initials(item.name)}</Text>
              </View>
              <View style={s.residentInfo}>
                <Text style={s.residentName}>{item.name}</Text>
                <Text style={s.residentUnit}>Unit: {item.unit ?? '—'}</Text>
              </View>
              {item.phone && (
                <Pressable style={s.callBtn}>
                  <Ionicons name="call-outline" size={18} color="#10B981" />
                </Pressable>
              )}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0F172A' },
  header: { paddingHorizontal: 16, paddingVertical: 16 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#fff' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1e293b', borderRadius: 10, marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  listBody: { paddingHorizontal: 16, paddingBottom: 40 },
  residentCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  residentInfo: { flex: 1 },
  residentName: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 2 },
  residentUnit: { fontSize: 12, color: '#64748b' },
  callBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(16,185,129,0.15)', alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: '#64748b' },
});
