// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { checkInMeeting, getMeeting } from '@/api/meetings.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function MeetingAttendance() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = getActiveEstateContext();
  const qc = useQueryClient();

  const { data: meeting, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['meeting', estateId, id],
    queryFn: () => getMeeting(estateId, id),
    staleTime: 30_000,
  });

  const checkinMut = useMutation({
    mutationFn: () => checkInMeeting(estateId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting', estateId, id] }),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Attendance</Text>
        <View style={{ width: 38 }} />
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.DEFAULT} /></View>
      ) : (
        <FlatList
          data={[]}
          keyExtractor={(_, i) => String(i)}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary.DEFAULT} />}
          ListHeaderComponent={
            <View style={styles.headerSection}>
              <View style={styles.qrPlaceholder}>
                <Ionicons name="qr-code-outline" size={64} color={colors.primary.DEFAULT} />
                <Text style={styles.qrLabel}>Scan to Check In</Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statNum}>{meeting?.attendee_count ?? 0}</Text>
                  <Text style={styles.statLabel}>Present</Text>
                </View>
                <View style={[styles.statCard, { borderColor: colors.neutral.border }]}>
                  <Text style={[styles.statNum, { color: colors.neutral.textMuted }]}>—</Text>
                  <Text style={styles.statLabel}>Total</Text>
                </View>
              </View>

              <Pressable style={[styles.checkinBtn, checkinMut.isPending && { opacity: 0.6 }]} onPress={() => checkinMut.mutate()} disabled={checkinMut.isPending}>
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={styles.checkinText}>{checkinMut.isPending ? 'Checking in...' : 'Manual Check In'}</Text>
              </Pressable>

              <Text style={styles.sectionTitle}>Attendees</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={40} color={colors.neutral.placeholder} />
              <Text style={styles.emptyText}>No attendees checked in yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, styles.listRow]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>AB</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>Attendee Name</Text>
                <Text style={styles.listSub}>Checked in at 10:05 AM</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.secondary.emerald + '22' }]}>
                <Text style={[styles.badgeText, { color: colors.secondary.emerald }]}>present</Text>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerSection: { padding: 16, gap: 14 },
  qrPlaceholder: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 28, alignItems: 'center', gap: 10, borderWidth: 2, borderColor: colors.neutral.border, borderStyle: 'dashed' },
  qrLabel: { fontSize: 14, fontWeight: '600', color: colors.neutral.textMuted },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: { flex: 1, backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 2, borderColor: colors.primary.DEFAULT },
  statNum: { fontSize: 24, fontWeight: '800', color: colors.primary.DEFAULT },
  statLabel: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  checkinBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.secondary.emerald, borderRadius: 14, height: 50 },
  checkinText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  listContent: { paddingBottom: 40 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, marginHorizontal: 16, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary.DEFAULT + '22', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700', color: colors.primary.DEFAULT },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 10, margin: 16 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
