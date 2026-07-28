// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMeeting } from '@/api/meetings.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function MeetingMinutes() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = getActiveEstateContext();

  const { data: meeting, isLoading, isError, refetch } = useQuery({
    queryKey: ['meeting', estateId, id],
    queryFn: () => getMeeting(estateId, id),
    staleTime: 30_000,
  });

  const handleDownload = () => {
    if (meeting?.minutes_url) Linking.openURL(meeting.minutes_url);
  };

  const handleApprove = () => Alert.alert('Confirm', 'Approve these minutes?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Approve', onPress: () => Alert.alert('Success', 'Minutes approved') },
  ]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Meeting Minutes</Text>
        <View style={{ width: 38 }} />
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.DEFAULT} /></View>
      ) : isError ? (
        <View style={styles.centered}>
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>Failed to load minutes</Text>
            <Pressable style={styles.retryBtn} onPress={() => refetch()}><Text style={styles.retryText}>Retry</Text></Pressable>
          </View>
        </View>
      ) : !meeting?.minutes_url ? (
        <View style={styles.centered}>
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={48} color={colors.neutral.placeholder} />
            <Text style={styles.emptyTitle}>Minutes Not Yet Uploaded</Text>
            <Text style={styles.emptyText}>Check back after the meeting concludes</Text>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <View style={styles.cardPad}>
              <Text style={styles.sectionTitle}>Meeting Minutes</Text>
              <Text style={styles.bodyText}>
                Minutes for "{meeting.title}" on {meeting.date}.{'\n\n'}
                This document contains the official record of discussions, decisions, and action items from the meeting.
              </Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.secondary.DEFAULT }]} onPress={handleDownload}>
              <Ionicons name="download-outline" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>Download PDF</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.secondary.emerald }]} onPress={handleApprove}>
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>Approve Minutes</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardPad: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, marginBottom: 10 },
  bodyText: { fontSize: 14, color: colors.neutral.text, lineHeight: 24 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, height: 50 },
  actionBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 8, width: '100%' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  errorCard: { backgroundColor: '#fee2e2', borderRadius: 14, padding: 20, alignItems: 'center', gap: 10 },
  errorText: { color: colors.secondary.red, fontWeight: '600' },
  retryBtn: { backgroundColor: colors.secondary.red, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: '#fff', fontWeight: '700' },
});
