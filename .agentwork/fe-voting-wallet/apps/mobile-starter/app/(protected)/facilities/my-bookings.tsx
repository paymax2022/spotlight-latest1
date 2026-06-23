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
  confirmed: { bg: '#dcfce7', text: '#166534' },
  cancelled: { bg: '#fee2e2', text: '#991b1b' },
  expired: { bg: '#f3f4f6', text: '#6b7280' },
};

export default function MyBookingsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState('upcoming');
  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });
  const estateId = ctx?.estateId ?? '';

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['my-bookings', estateId, tab],
    queryFn: async () => {
      const res = await fetch(`/api/facility-bookings?tab=${tab}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const bookings = data ?? [];

  const renderItem = ({ item, index }) => {
    const sc = STATUS_C[item.status] ?? STATUS_C.confirmed;
    const isLast = index === bookings.length - 1;
    return (
      <View style={[s.row, !isLast && s.rowBorder]}>
        <View style={s.iconBox}><Ionicons name="calendar-outline" size={20} color={colors.primary.DEFAULT} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{item.facility_name}</Text>
          <Text style={s.sub}>{item.date ? new Date(item.date).toLocaleDateString('en-NG') : '—'} · {item.slot}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <View style={[s.badge, { backgroundColor: sc.bg }]}><Text style={[s.badgeTxt, { color: sc.text }]}>{item.status}</Text></View>
          {tab === 'upcoming' && item.status !== 'cancelled' && (
            <Pressable onPress={() => router.push(`/facilities/cancel?bookingId=${item.id}` as never)}>
              <Text style={s.cancelTxt}>Cancel</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>My Bookings</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={s.tabRow}>
        {['upcoming', 'past'].map((t) => (
          <Pressable key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
          </Pressable>
        ))}
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load bookings</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          contentContainerStyle={bookings.length === 0 ? { flex: 1 } : { paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="calendar-outline" size={48} color={colors.neutral.placeholder} />
              <Text style={s.emptyTxt}>No {tab} bookings</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  tabRow: { flexDirection: 'row', backgroundColor: colors.neutral.surface, borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary.DEFAULT },
  tabTxt: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '500' },
  tabTxtActive: { color: colors.primary.DEFAULT, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.neutral.surface },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  sub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeTxt: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  cancelTxt: { fontSize: 12, color: '#dc2626', fontWeight: '600' },
  empty: { alignItems: 'center', gap: 10, marginTop: 60 },
  emptyTxt: { fontSize: 14, color: colors.neutral.textMuted },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
