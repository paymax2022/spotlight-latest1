// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const STATUS_COLORS = {
  submitted: '#3b82f6',
  inspecting: '#f59e0b',
  assigned: '#8b5cf6',
  in_progress: '#f97316',
  completed: '#10b981',
  closed: '#6b7280',
};

export default function RepairStatusScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['repair-timeline', id],
    queryFn: async () => {
      const res = await fetch(`/api/repairs/${id}/timeline`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!id,
  });

  const timeline = (data ?? []).slice().reverse();

  const renderItem = ({ item, index }) => {
    const color = STATUS_COLORS[item.status] ?? '#6b7280';
    const isLast = index === timeline.length - 1;
    return (
      <View style={s.timelineItem}>
        <View style={s.timelineLeft}>
          <View style={[s.dot, { backgroundColor: color }]} />
          {!isLast && <View style={s.connector} />}
        </View>
        <View style={[s.timelineCard, !isLast && { marginBottom: 0 }]}>
          <Text style={[s.statusLabel, { color }]}>{item.status?.replace('_', ' ').toUpperCase()}</Text>
          <Text style={s.timestamp}>{new Date(item.timestamp).toLocaleString('en-NG')}</Text>
          {item.actor && <Text style={s.actor}>by {item.actor}</Text>}
          {item.note && <Text style={s.note}>{item.note}</Text>}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Status Timeline</Text>
        <View style={{ width: 38 }} />
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load timeline</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={timeline}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderItem}
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="time-outline" size={48} color={colors.neutral.placeholder} />
              <Text style={s.emptyTxt}>No timeline events yet</Text>
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
  content: { padding: 20, paddingBottom: 40 },
  timelineItem: { flexDirection: 'row', gap: 12 },
  timelineLeft: { alignItems: 'center', width: 20 },
  dot: { width: 14, height: 14, borderRadius: 7, marginTop: 3 },
  connector: { flex: 1, width: 2, backgroundColor: colors.neutral.border, marginVertical: 4 },
  timelineCard: { flex: 1, backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  statusLabel: { fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  timestamp: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  actor: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  note: { fontSize: 13, color: colors.neutral.text, marginTop: 6, lineHeight: 18 },
  empty: { alignItems: 'center', gap: 10, marginTop: 60 },
  emptyTxt: { fontSize: 14, color: colors.neutral.textMuted },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
