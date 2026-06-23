// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listAccessCodes } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function VehicleLogScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const { data: codes = [], isLoading } = useQuery({
    queryKey: ['access-codes-vehicles'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      const all = await listAccessCodes(ctx.estateId, 'active');
      return all.filter((c) => c.vehicle_plate);
    },
  });

  const filtered = codes.filter((c) =>
    !search ||
    (c.vehicle_plate ?? '').toLowerCase().includes(search.toLowerCase()) ||
    c.visitor_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <Text style={styles.heading}>Vehicle Log</Text>
            <Text style={styles.sub}>Active passes with registered vehicles</Text>
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder="Search plate or name…"
              placeholderTextColor={colors.neutral.placeholder}
            />
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="car-outline" size={40} color={colors.neutral.placeholder} />
            <Text style={styles.emptyText}>{isLoading ? 'Loading…' : 'No vehicle passes active.'}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push({ pathname: '/estate/guard/visitor-confirm', params: { codeId: item.id } } as never)}
          >
            <View style={styles.plateBox}>
              <Text style={styles.plate}>{item.vehicle_plate}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.visitor_name}</Text>
              <Text style={styles.meta}>{item.code_type.replace(/_/g, ' ')} · Code {item.numeric_code}</Text>
              <Text style={styles.expiry}>Until {new Date(item.valid_until).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  list: { padding: 20, gap: 10 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2, marginBottom: 10 },
  search: { backgroundColor: '#fff', borderRadius: 12, padding: 12, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 4 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  plateBox: { backgroundColor: '#1E3A5F', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 70, alignItems: 'center' },
  plate: { fontFamily: 'monospace', fontSize: 13, fontWeight: '800', color: '#FFF', letterSpacing: 1 },
  name: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  meta: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2, textTransform: 'capitalize' },
  expiry: { fontSize: 11, color: colors.neutral.placeholder, marginTop: 2 },
  empty: { alignItems: 'center', gap: 10, marginTop: 40 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
