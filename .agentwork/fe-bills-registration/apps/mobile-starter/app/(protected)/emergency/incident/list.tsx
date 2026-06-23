// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const STATUS_C = {
  reported: { bg: '#dbeafe', text: '#1d4ed8' },
  acknowledged: { bg: '#fef3c7', text: '#92400e' },
  responding: { bg: '#fff7ed', text: '#c2410c' },
  resolved: { bg: '#dcfce7', text: '#166534' },
};

const CAT_ICONS = {
  theft: 'bag-remove-outline',
  vandalism: 'hammer-outline',
  noise: 'volume-high-outline',
  fire: 'flame-outline',
  medical: 'medkit-outline',
  other: 'alert-circle-outline',
};

export default function IncidentListScreen() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState('all');
  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });
  const estateId = ctx?.estateId ?? '';

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['my-incidents', estateId, statusFilter],
    queryFn: async () => {
      const q = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const res = await fetch(`/api/emergency/incidents/mine${q}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const incidents = data ?? [];
  const STATUSES = ['all', 'reported', 'acknowledged', 'responding', 'resolved'];

  const renderItem = ({ item, index }) => {
    const sc = STATUS_C[item.status] ?? STATUS_C.reported;
    const icon = CAT_ICONS[item.category] ?? 'alert-circle-outline';
    const isLast = index === incidents.length - 1;
    return (
      <Pressable style={[s.row, !isLast && s.rowBorder]} onPress={() => router.push(`/emergency/incident/${item.id}` as never)}>
        <View style={s.iconBox}><Ionicons name={icon} size={20} color="#dc2626" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{item.title ?? item.category}</Text>
          <Text style={s.sub}>{item.created_at ? new Date(item.created_at).toLocaleDateString('en-NG') : '—'}</Text>
        </View>
        <View style={[s.badge, { backgroundColor: sc.bg }]}><Text style={[s.badgeTxt, { color: sc.text }]}>{item.status}</Text></View>
        <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>My Incidents</Text>
        <View style={{ width: 38 }} />
      </View>
      <FlatList
        horizontal
        data={STATUSES}
        keyExtractor={(i) => i}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filterRow}
        renderItem={({ item }) => (
          <Pressable style={[s.filterChip, statusFilter === item && s.filterChipActive]} onPress={() => setStatusFilter(item)}>
            <Text style={[s.filterTxt, statusFilter === item && s.filterTxtActive]}>{item.charAt(0).toUpperCase() + item.slice(1)}</Text>
          </Pressable>
        )}
      />
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load incidents</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={incidents}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          contentContainerStyle={incidents.length === 0 ? { flex: 1 } : { paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="alert-circle-outline" size={48} color={colors.neutral.placeholder} />
              <Text style={s.emptyTxt}>No incidents reported</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#dc2626' },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  filterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.neutral.surface, borderWidth: 1, borderColor: colors.neutral.border },
  filterChipActive: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  filterTxt: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '500' },
  filterTxtActive: { color: '#fff', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.neutral.surface },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  sub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeTxt: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  empty: { alignItems: 'center', gap: 10, marginTop: 60 },
  emptyTxt: { fontSize: 14, color: colors.neutral.textMuted },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
