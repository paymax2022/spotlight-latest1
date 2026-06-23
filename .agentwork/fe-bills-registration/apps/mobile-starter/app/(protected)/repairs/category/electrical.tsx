// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const STATUS_C = {
  open: { bg: '#dbeafe', text: '#1d4ed8' },
  in_progress: { bg: '#fef3c7', text: '#92400e' },
  resolved: { bg: '#dcfce7', text: '#166534' },
};

export default function ElectricalRepairsScreen() {
  const router = useRouter();
  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });
  const estateId = ctx?.estateId ?? '';

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['repairs', estateId, 'mine', 'electrical'],
    queryFn: async () => {
      if (!estateId) return [];
      const res = await fetch(`/api/estates/${estateId}/repairs?scope=mine&category=electrical`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!estateId,
  });

  const repairs = data ?? [];

  const renderItem = ({ item, index }) => {
    const sc = STATUS_C[item.status] ?? STATUS_C.open;
    const isLast = index === repairs.length - 1;
    return (
      <Pressable style={[s.row, !isLast && s.rowBorder]} onPress={() => router.push(`/repairs/${item.id}` as never)}>
        <View style={s.catBox}><Ionicons name="flash-outline" size={22} color="#f59e0b" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{item.title}</Text>
          <Text style={s.sub}>{item.location} · {new Date(item.created_at).toLocaleDateString('en-NG')}</Text>
        </View>
        <View style={[s.badge, { backgroundColor: sc.bg }]}><Text style={[s.badgeTxt, { color: sc.text }]}>{item.status?.replace('_', ' ')}</Text></View>
        <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Electrical Repairs</Text>
        <View style={{ width: 38 }} />
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load repairs</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={repairs}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={repairs.length === 0 ? { flex: 1 } : { paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="flash-outline" size={48} color={colors.neutral.placeholder} />
              <Text style={s.emptyTxt}>No electrical repair tickets</Text>
            </View>
          }
        />
      )}
      <Pressable style={s.fab} onPress={() => router.push('/repairs/create' as never)}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.neutral.surface },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  catBox: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f59e0b22' },
  title: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  sub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeTxt: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  empty: { alignItems: 'center', gap: 10, marginTop: 60 },
  emptyTxt: { fontSize: 14, color: colors.neutral.textMuted },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary.DEFAULT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 },
});
