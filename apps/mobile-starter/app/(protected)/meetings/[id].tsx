// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMeeting, rsvpMeeting, checkInMeeting } from '@/api/meetings.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const typeColors = { physical: colors.secondary.emerald, virtual: colors.secondary.DEFAULT, hybrid: colors.secondary.amber };

export default function MeetingDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = getActiveEstateContext();
  const qc = useQueryClient();

  const { data: meeting, isLoading, isError, refetch } = useQuery({
    queryKey: ['meeting', estateId, id],
    queryFn: () => getMeeting(estateId, id),
    staleTime: 30_000,
  });

  const rsvpMut = useMutation({
    mutationFn: (status: string) => rsvpMeeting(estateId, id, status),
    onSuccess: () => {
      Alert.alert('Success', 'RSVP updated');
      qc.invalidateQueries({ queryKey: ['meeting', estateId, id] });
    },
  });

  const checkinMut = useMutation({
    mutationFn: () => checkInMeeting(estateId, id),
    onSuccess: () => Alert.alert('Success', 'Checked in successfully'),
  });

  if (isLoading) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Meeting Detail</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.DEFAULT} /></View>
    </SafeAreaView>
  );

  if (isError || !meeting) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Meeting Detail</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={styles.centered}>
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>Failed to load meeting</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Meeting Detail</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.cardPad}>
            <Text style={styles.meetingTitle}>{meeting.title}</Text>
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: typeColors[meeting.type] + '22' }]}>
                <Text style={[styles.badgeText, { color: typeColors[meeting.type] }]}>{meeting.type}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: meeting.status === 'upcoming' ? colors.secondary.DEFAULT + '22' : colors.neutral.border }]}>
                <Text style={[styles.badgeText, { color: meeting.status === 'upcoming' ? colors.secondary.DEFAULT : colors.neutral.textMuted }]}>{meeting.status}</Text>
              </View>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="calendar-outline" size={16} color={colors.neutral.textMuted} />
              <Text style={styles.infoText}>{meeting.date} at {meeting.time}</Text>
            </View>
            {meeting.location ? (
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={16} color={colors.neutral.textMuted} />
                <Text style={styles.infoText}>{meeting.location}</Text>
              </View>
            ) : null}
            <View style={styles.infoRow}>
              <Ionicons name="people-outline" size={16} color={colors.neutral.textMuted} />
              <Text style={styles.infoText}>{meeting.attendee_count} attendees</Text>
            </View>
          </View>
        </View>

        {meeting.agenda ? (
          <View style={styles.card}>
            <View style={styles.cardPad}>
              <Text style={styles.sectionTitle}>Agenda</Text>
              <Text style={styles.bodyText}>{meeting.agenda}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.cardPad}>
            <Text style={styles.sectionTitle}>Your RSVP</Text>
            <View style={styles.rsvpRow}>
              {(['yes', 'no', 'maybe'] as const).map(s => (
                <Pressable
                  key={s}
                  style={[styles.rsvpChip, meeting.rsvp_status === s && styles.rsvpChipActive(s)]}
                  onPress={() => rsvpMut.mutate(s)}
                  disabled={rsvpMut.isPending}
                >
                  <Text style={[styles.rsvpText, meeting.rsvp_status === s && { color: '#fff' }]}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.actionsGrid}>
          {meeting.type === 'virtual' ? (
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.secondary.DEFAULT }]}>
              <Ionicons name="videocam-outline" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>Join Meeting</Text>
            </Pressable>
          ) : null}
          {meeting.status === 'ongoing' ? (
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.secondary.emerald }]} onPress={() => checkinMut.mutate()} disabled={checkinMut.isPending}>
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>{checkinMut.isPending ? 'Checking in...' : 'Check In'}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.quickLinks}>
          {[
            { label: 'Agenda', icon: 'list-outline', path: `/meetings/${id}/agenda` },
            { label: 'Attendance', icon: 'people-outline', path: `/meetings/${id}/attendance` },
            { label: 'Minutes', icon: 'document-text-outline', path: `/meetings/${id}/minutes` },
            { label: 'Decisions', icon: 'checkmark-done-outline', path: `/meetings/${id}/decisions` },
            { label: 'Actions', icon: 'hammer-outline', path: `/meetings/${id}/actions` },
            { label: 'Discussion', icon: 'chatbubbles-outline', path: `/meetings/${id}/chat` },
          ].map(item => (
            <Pressable key={item.label} style={styles.quickLink} onPress={() => router.push(item.path as never)}>
              <View style={styles.quickLinkIcon}>
                <Ionicons name={item.icon as any} size={20} color={colors.primary.DEFAULT} />
              </View>
              <Text style={styles.quickLinkText}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const rsvpChipActive = (s: string) => ({
  backgroundColor: s === 'yes' ? colors.secondary.emerald : s === 'no' ? colors.secondary.red : colors.secondary.amber,
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardPad: { padding: 16 },
  meetingTitle: { fontSize: 20, fontWeight: '800', color: colors.neutral.text, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  infoText: { fontSize: 14, color: colors.neutral.textMuted },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, marginBottom: 10 },
  bodyText: { fontSize: 14, color: colors.neutral.text, lineHeight: 22 },
  rsvpRow: { flexDirection: 'row', gap: 10 },
  rsvpChip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.neutral.border, alignItems: 'center' },
  rsvpChipActive: (s: string) => ({ backgroundColor: s === 'yes' ? colors.secondary.emerald : s === 'no' ? colors.secondary.red : colors.secondary.amber, borderColor: 'transparent' }),
  rsvpText: { fontSize: 14, fontWeight: '600', color: colors.neutral.textMuted },
  actionsGrid: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, height: 50 },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  quickLinks: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  quickLink: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  quickLinkIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  quickLinkText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorCard: { backgroundColor: '#fee2e2', borderRadius: 14, padding: 20, alignItems: 'center', gap: 10, margin: 20 },
  errorText: { color: colors.secondary.red, fontWeight: '600' },
  retryBtn: { backgroundColor: colors.secondary.red, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: '#fff', fontWeight: '700' },
});
