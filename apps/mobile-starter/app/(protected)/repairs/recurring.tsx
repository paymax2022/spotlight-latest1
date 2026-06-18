// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const FREQ_COLORS = {
  weekly: { bg: '#dbeafe', text: '#1d4ed8' },
  monthly: { bg: '#dcfce7', text: '#166534' },
  quarterly: { bg: '#fef3c7', text: '#92400e' },
  annual: { bg: '#f3e8ff', text: '#7c3aed' },
};

export default function RecurringMaintenanceScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });
  const estateId = ctx?.estateId ?? '';

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['recurring-maintenance', estateId],
    queryFn: async () => {
      if (!estateId) return [];
      const res = await fetch(`/api/estates/${estateId}/maintenance/recurring`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!estateId,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }) => {
      const res = await fetch(`/api/estates/${estateId}/maintenance/recurring/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring-maintenance', estateId] }),
  });

  const schedules = data ?? [];

  const renderItem = ({ item, index }) => {
    const fc = FREQ_COLORS[item.frequency] ?? FREQ_COLORS.monthly;
    const isLast = index === schedules.length - 1;
    return (
      <View style={[s.row, !isLast && s.rowBorder]}>
        <View style={s.iconBox}>
          <Ionicons name="repeat-outline" size={20} color={colors.primary.DEFAULT} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{item.title}</Text>
          <Text style={s.sub}>Next due: {item.next_due ? new Date(item.next_due).toLocaleDateString('en-NG') : '—'}</Text>
        </View>
        <View style={[s.badge, { backgroundColor: fc.bg }]}><Text style={[s.badgeTxt, { color: fc.text }]}>{item.frequency}</Text></View>
        <Switch
          value={item.active}
          onValueChange={(v) => toggleMutation.mutate({ id: item.id, active: v })}
          trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }}
          thumbColor="#fff"
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Recurring Maintenance</Text>
        <View style={{ width: 38 }} />
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load schedules</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={schedules}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="repeat-outline" size={48} color={colors.neutral.placeholder} />
              <Text style={s.emptyTxt}>No recurring schedules</Text>
            </View>
          }
        />
      )}
      <View style={s.addBtnWrapper}>
        <Pressable style={s.addBtn} onPress={() => router.push('/repairs/schedule' as never)}>
          <Text style={s.addBtnTxt}>Add Schedule</Text>
        </Pressable>
      </View>
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
  iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  sub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeTxt: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  empty: { alignItems: 'center', gap: 10, marginTop: 60 },
  emptyTxt: { fontSize: 14, color: colors.neutral.textMuted },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
  addBtnWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: colors.neutral.surface, borderTopWidth: 1, borderTopColor: colors.neutral.border },
  addBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  addBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
