// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function MeetingReschedule() {
  const router = useRouter();
  const { id, title, oldDate, newDate } = useLocalSearchParams<{ id?: string; title?: string; oldDate?: string; newDate?: string }>();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Meeting Rescheduled</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.noticeBanner}>
          <Ionicons name="refresh-circle-outline" size={28} color="#fff" />
          <Text style={styles.noticeText}>This meeting has been rescheduled</Text>
        </View>

        <View style={styles.iconWrap}>
          <Ionicons name="calendar-outline" size={64} color={colors.secondary.DEFAULT} />
        </View>

        <Text style={styles.mainTitle}>Meeting Rescheduled</Text>
        <Text style={styles.subTitle}>Please update your calendar accordingly</Text>

        <View style={styles.detailCard}>
          <Text style={styles.detailLabel}>Meeting</Text>
          <Text style={styles.detailValue}>{title ?? 'Annual General Meeting'}</Text>
          <View style={styles.divider} />

          <Text style={styles.detailLabel}>Old Date</Text>
          <Text style={[styles.detailValue, styles.strikethrough]}>{oldDate ?? 'January 20, 2025 at 10:00 AM'}</Text>

          <View style={styles.arrowWrap}>
            <Ionicons name="arrow-down" size={18} color={colors.secondary.DEFAULT} />
          </View>

          <View style={styles.newDateBox}>
            <Text style={styles.newDateLabel}>New Date</Text>
            <Text style={styles.newDateValue}>{newDate ?? 'February 3, 2025 at 10:00 AM'}</Text>
          </View>
        </View>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={colors.secondary.DEFAULT} />
          <Text style={styles.infoText}>Your RSVP has been reset. Please confirm your attendance for the new date.</Text>
        </View>

        <View style={styles.btnRow}>
          <Pressable style={[styles.primaryBtn, { backgroundColor: colors.secondary.DEFAULT }]} onPress={() => router.push(`/meetings/${id}/rsvp` as never)}>
            <Text style={styles.primaryBtnText}>Update RSVP</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={() => router.push('/meetings' as never)}>
            <Text style={styles.secondaryBtnText}>Back to Meetings</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 20, alignItems: 'center' },
  noticeBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.secondary.DEFAULT, borderRadius: 14, padding: 16, width: '100%' },
  noticeText: { color: '#fff', fontWeight: '700', fontSize: 15, flex: 1 },
  iconWrap: { width: 100, height: 100, borderRadius: 50, backgroundColor: colors.secondary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  mainTitle: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  subTitle: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  detailCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, alignItems: 'center' },
  detailLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600', marginBottom: 2, alignSelf: 'flex-start' },
  detailValue: { fontSize: 15, color: colors.neutral.text, fontWeight: '500', alignSelf: 'flex-start' },
  strikethrough: { textDecorationLine: 'line-through', color: colors.neutral.textMuted },
  divider: { height: 1, backgroundColor: colors.neutral.border, marginVertical: 12, width: '100%' },
  arrowWrap: { marginVertical: 8 },
  newDateBox: { backgroundColor: colors.secondary.DEFAULT + '15', borderRadius: 12, padding: 12, width: '100%', gap: 2 },
  newDateLabel: { fontSize: 12, color: colors.secondary.DEFAULT, fontWeight: '700' },
  newDateValue: { fontSize: 16, color: colors.secondary.DEFAULT, fontWeight: '800' },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.secondary.DEFAULT + '10', borderRadius: 12, padding: 14, width: '100%' },
  infoText: { flex: 1, fontSize: 13, color: colors.neutral.text, lineHeight: 20 },
  btnRow: { width: '100%', gap: 10 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%', borderWidth: 1, borderColor: colors.neutral.border },
  secondaryBtnText: { fontSize: 16, fontWeight: '600', color: colors.neutral.textMuted },
});
