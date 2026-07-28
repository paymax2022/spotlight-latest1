// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getExpectedVisitors } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const TYPE_COLORS: Record<string, string> = {
  one_time: '#6C63FF', multi_day: '#3B82F6', recurring: '#10B981',
  delivery: '#F59E0B', ridehailing: '#8B5CF6', staff: '#EF4444',
  contractor: '#06B6D4', event_guest: '#EC4899', family: '#10B981',
};

export default function ExpectedVisitorsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const { data: visitors = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['expected-visitors'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return getExpectedVisitors(ctx.estateId);
    },
    refetchInterval: 60_000,
  });

  const filtered = visitors.filter((v) =>
    !search ||
    v.visitor_name.toLowerCase().includes(search.toLowerCase()) ||
    v.numeric_code.includes(search) ||
    (v.vehicle_plate ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={filtered}
        keyExtractor={(v) => v.id}
        contentContainerStyle={styles.list}
        onRefresh={refetch}
        refreshing={isRefetching}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <Text style={styles.heading}>Expected Visitors</Text>
              <Text style={styles.sub}>Next 4 hours · {visitors.length} expected</Text>
            </View>
            <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="Search name, code, plate…" placeholderTextColor={colors.neutral.placeholder} />
          </>
        }
        ListEmptyComponent={
          isLoading
            ? <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
            : (
              <View style={styles.empty}>
                <Ionicons name="calendar-outline" size={40} color={colors.neutral.placeholder} />
                <Text style={styles.emptyText}>No expected visitors in the next 4 hours.</Text>
              </View>
            )
        }
        renderItem={({ item }) => {
          const typeColor = TYPE_COLORS[item.code_type] ?? '#94A3B8';
          return (
            <Pressable
              style={[styles.card, item.blacklisted && styles.cardBlacklisted]}
              onPress={() => router.push({ pathname: '/estate/guard/visitor-confirm', params: { codeId: item.id } } as never)}
            >
              <View style={[styles.typeIcon, { backgroundColor: typeColor + '18' }]}>
                <Ionicons name="person-outline" size={20} color={typeColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.visitor_name}</Text>
                <Text style={styles.meta}>
                  {item.code_type.replace(/_/g, ' ')} · {item.numeric_code}
                  {item.vehicle_plate ? ` · ${item.vehicle_plate}` : ''}
                </Text>
                <Text style={styles.expiry}>
                  Arrives by {new Date(item.valid_until).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              {item.blacklisted && (
                <Ionicons name="ban" size={20} color="#DC2626" />
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  list: { padding: 20, gap: 10 },
  header: { marginBottom: 8 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2 },
  search: { backgroundColor: '#fff', borderRadius: 12, padding: 12, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 4 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  cardBlacklisted: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  typeIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  meta: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2, textTransform: 'capitalize' },
  expiry: { fontSize: 11, color: colors.neutral.placeholder, marginTop: 2 },
  empty: { alignItems: 'center', gap: 10, marginTop: 40 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
});
