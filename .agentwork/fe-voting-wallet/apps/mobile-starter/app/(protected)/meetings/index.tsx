// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listMeetings } from '@/api/meetings.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const TABS = ['Upcoming', 'Past'];

const rsvpColors = {
  yes: colors.secondary.emerald,
  no: colors.secondary.red,
  maybe: colors.secondary.amber,
};

export default function MeetingsIndex() {
  const router = useRouter();
  const { estateId } = getActiveEstateContext();
  const [activeTab, setActiveTab] = useState(0);

  const filter = activeTab === 0 ? 'upcoming' : 'past';

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['meetings', estateId, filter],
    queryFn: () => listMeetings(estateId, filter),
    staleTime: 30_000,
  });

  const upcomingCount = activeTab === 0 ? (data?.length ?? 0) : 0;
  const pastCount = activeTab === 1 ? (data?.length ?? 0) : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Meetings</Text>
        <Pressable style={styles.backBtn} onPress={() => router.push('/meetings/calendar' as never)}>
          <Ionicons name="calendar-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { borderColor: colors.secondary.DEFAULT }]}>
          <Text style={[styles.statNum, { color: colors.secondary.DEFAULT }]}>{activeTab === 0 ? (data?.length ?? 0) : '-'}</Text>
          <Text style={styles.statLabel}>Upcoming</Text>
        </View>
        <View style={[styles.statCard, { borderColor: colors.neutral.border }]}>
          <Text style={[styles.statNum, { color: colors.neutral.textMuted }]}>{activeTab === 1 ? (data?.length ?? 0) : '-'}</Text>
          <Text style={styles.statLabel}>Past</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        {TABS.map((t, i) => (
          <Pressable key={t} style={[styles.tab, activeTab === i && styles.tabActive]} onPress={() => setActiveTab(i)}>
            <Text style={[styles.tabText, activeTab === i && styles.tabTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>Failed to load meetings</Text>
            <Pressable style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary.DEFAULT} />}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="calendar-outline" size={40} color={colors.neutral.placeholder} />
              <Text style={styles.emptyText}>No meetings scheduled</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => router.push(`/meetings/${item.id}` as never)}>
              <View style={styles.listRow}>
                <View style={styles.iconWrap}>
                  <Ionicons name={item.type === 'virtual' ? 'videocam-outline' : 'people-outline'} size={22} color={colors.primary.DEFAULT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>{item.title}</Text>
                  <Text style={styles.listSub}>{item.date} · {item.time} · {item.location ?? 'Virtual'}</Text>
                </View>
                {item.rsvp_status ? (
                  <View style={[styles.badge, { backgroundColor: rsvpColors[item.rsvp_status] + '22' }]}>
                    <Text style={[styles.badgeText, { color: rsvpColors[item.rsvp_status] }]}>{item.rsvp_status}</Text>
                  </View>
                ) : (
                  <View style={[styles.badge, { backgroundColor: colors.neutral.border }]}>
                    <Text style={[styles.badgeText, { color: colors.neutral.textMuted }]}>No RSVP</Text>
                  </View>
                )}
              </View>
            </Pressable>
          )}
        />
      )}

      <Pressable style={styles.fab} onPress={() => router.push('/meetings/create' as never)}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  statsRow: { flexDirection: 'row', gap: 12, padding: 16 },
  statCard: { flex: 1, backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1 },
  statNum: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  tabRow: { flexDirection: 'row', marginHorizontal: 16, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, padding: 4, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: colors.primary.DEFAULT },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.neutral.textMuted },
  tabTextActive: { color: '#fff' },
  listContent: { padding: 16, gap: 10, paddingBottom: 80 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 10, marginTop: 20 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorCard: { backgroundColor: '#fee2e2', borderRadius: 14, padding: 20, alignItems: 'center', gap: 10, margin: 20 },
  errorText: { color: colors.secondary.red, fontWeight: '600' },
  retryBtn: { backgroundColor: colors.secondary.red, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: '#fff', fontWeight: '700' },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
});
