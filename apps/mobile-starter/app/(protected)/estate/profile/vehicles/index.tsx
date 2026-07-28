// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listVehicles } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function VehiclesScreen() {
  const router = useRouter();

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['resident-vehicles'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return listVehicles(ctx.estateId);
    },
  });

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={vehicles}
        keyExtractor={(v) => v.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.heading}>My Vehicles</Text>
            <Pressable style={styles.addBtn} onPress={() => router.push('/estate/profile/vehicles/add' as never)}>
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.addBtnText}>Register</Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          isLoading
            ? <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
            : (
              <View style={styles.empty}>
                <Ionicons name="car-outline" size={48} color={colors.neutral.placeholder} />
                <Text style={styles.emptyText}>No vehicles registered.</Text>
                <Pressable style={styles.emptyBtn} onPress={() => router.push('/estate/profile/vehicles/add' as never)}>
                  <Text style={styles.emptyBtnText}>Register a Vehicle</Text>
                </Pressable>
              </View>
            )
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="car" size={24} color="#10B981" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.plate}>{item.plate}</Text>
              <Text style={styles.detail}>
                {[item.make, item.model, item.color].filter(Boolean).join(' · ') || 'No details'}
              </Text>
            </View>
            {item.verified ? (
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            ) : (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingText}>Pending</Text>
              </View>
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  list: { padding: 20, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#10B981', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  iconWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#D1FAE5', alignItems: 'center', justifyContent: 'center' },
  plate: { fontSize: 16, fontWeight: '800', color: colors.neutral.text, letterSpacing: 1 },
  detail: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2, textTransform: 'capitalize' },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  verifiedText: { fontSize: 11, fontWeight: '700', color: '#10B981' },
  pendingBadge: { backgroundColor: '#FEF9C3', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  pendingText: { fontSize: 11, fontWeight: '700', color: '#D97706' },
  empty: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: colors.neutral.textMuted },
  emptyBtn: { backgroundColor: '#10B981', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
