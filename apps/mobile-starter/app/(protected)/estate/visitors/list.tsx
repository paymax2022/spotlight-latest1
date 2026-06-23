// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listAccessCodes } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const TABS = ['active', 'expired', 'revoked', 'used'];
const STATUS_COLOR = { active: '#10B981', used: '#6C5CE7', expired: '#94A3B8', revoked: '#EF4444' };

export default function VisitorListScreen() {
  const router = useRouter();
  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');

  const { data: codes = [], isLoading } = useQuery({
    queryKey: ['access-codes', tab],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return listAccessCodes(ctx.estateId, tab);
    },
  });

  const filtered = codes.filter((c) =>
    !search || c.visitor_name.toLowerCase().includes(search.toLowerCase()) || c.numeric_code.includes(search)
  );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <Text style={styles.heading}>All Access Codes</Text>
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder="Search name or code…"
              placeholderTextColor={colors.neutral.placeholder}
            />
            <View style={styles.tabRow}>
              {TABS.map((t) => (
                <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
                  <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
                </Pressable>
              ))}
            </View>
          </>
        }
        ListEmptyComponent={
          isLoading
            ? <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
            : <View style={styles.empty}><Text style={styles.emptyText}>No {tab} codes.</Text></View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push({ pathname: '/estate/visitors/code', params: { codeId: item.id } } as never)}
          >
            <View style={styles.codeBadge}>
              <Text style={styles.codeNum}>{item.numeric_code}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.visitor_name}</Text>
              <Text style={styles.meta}>
                {item.code_type.replace(/_/g, ' ')} · {new Date(item.valid_until).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                {item.vehicle_plate ? ` · ${item.vehicle_plate}` : ''}
              </Text>
            </View>
            <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[item.status] ?? '#94A3B8' }]} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  list: { padding: 20, gap: 10 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text, marginBottom: 8 },
  search: { backgroundColor: '#fff', borderRadius: 12, padding: 12, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 8 },
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F1F5F9' },
  tabActive: { backgroundColor: colors.primary.DEFAULT },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, textTransform: 'capitalize' },
  tabTextActive: { color: '#fff' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  codeBadge: { width: 52, height: 40, borderRadius: 10, backgroundColor: colors.primary.DEFAULT + '12', alignItems: 'center', justifyContent: 'center' },
  codeNum: { fontFamily: 'monospace', fontSize: 14, fontWeight: '800', color: colors.primary.DEFAULT, letterSpacing: 1.5 },
  name: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  meta: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2, textTransform: 'capitalize' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  empty: { alignItems: 'center', marginTop: 40 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted, textTransform: 'capitalize' },
});
