// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMeeting, rsvpMeeting } from '@/api/meetings.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const OPTIONS = [
  { value: 'yes', label: 'Yes, I will attend', icon: 'checkmark-circle-outline', color: colors.secondary.emerald },
  { value: 'no', label: 'No, I cannot attend', icon: 'close-circle-outline', color: colors.secondary.red },
  { value: 'maybe', label: 'Maybe', icon: 'help-circle-outline', color: colors.secondary.amber },
] as const;

export default function RSVPScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = getActiveEstateContext();
  const qc = useQueryClient();

  const { data: meeting, isLoading } = useQuery({
    queryKey: ['meeting', estateId, id],
    queryFn: () => getMeeting(estateId, id),
    staleTime: 30_000,
  });

  const rsvpMut = useMutation({
    mutationFn: (status: string) => rsvpMeeting(estateId, id, status),
    onSuccess: (_, status) => {
      Alert.alert('RSVP Confirmed', `You responded: ${status}`);
      qc.invalidateQueries({ queryKey: ['meetings', estateId] });
      router.back();
    },
    onError: () => Alert.alert('Error', 'Failed to submit RSVP'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>RSVP</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="calendar" size={60} color={colors.primary.DEFAULT} />
        </View>
        <Text style={styles.title}>Will you attend?</Text>

        {isLoading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} />
        ) : meeting ? (
          <View style={styles.summaryCard}>
            <Text style={styles.meetingTitle}>{meeting.title}</Text>
            <Text style={styles.meetingMeta}>{meeting.date} · {meeting.time}</Text>
            {meeting.location ? <Text style={styles.meetingMeta}>{meeting.location}</Text> : null}
          </View>
        ) : null}

        <View style={styles.optionsGroup}>
          {OPTIONS.map(opt => (
            <Pressable
              key={opt.value}
              style={[styles.optionBtn, { borderColor: opt.color }, rsvpMut.isPending && { opacity: 0.6 }]}
              onPress={() => rsvpMut.mutate(opt.value)}
              disabled={rsvpMut.isPending}
            >
              <Ionicons name={opt.icon as any} size={28} color={opt.color} />
              <Text style={[styles.optionText, { color: opt.color }]}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { flex: 1, padding: 24, alignItems: 'center', gap: 20 },
  iconWrap: { width: 100, height: 100, borderRadius: 50, backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  title: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  summaryCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, width: '100%', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.neutral.border },
  meetingTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, textAlign: 'center' },
  meetingMeta: { fontSize: 13, color: colors.neutral.textMuted },
  optionsGroup: { width: '100%', gap: 12 },
  optionBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 18, borderWidth: 2 },
  optionText: { fontSize: 16, fontWeight: '700' },
});
