// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function MeetingCancellation() {
  const router = useRouter();
  const { id, title, date, reason } = useLocalSearchParams<{ id?: string; title?: string; date?: string; reason?: string }>();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Meeting Cancelled</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.warningBanner}>
          <Ionicons name="warning-outline" size={28} color="#fff" />
          <Text style={styles.warningText}>This meeting has been cancelled</Text>
        </View>

        <View style={styles.iconWrap}>
          <Ionicons name="calendar-clear-outline" size={64} color={colors.secondary.amber} />
        </View>

        <Text style={styles.mainTitle}>Meeting Cancelled</Text>
        <Text style={styles.subTitle}>We're sorry for any inconvenience caused</Text>

        <View style={styles.detailCard}>
          <Text style={styles.detailLabel}>Meeting</Text>
          <Text style={styles.detailValue}>{title ?? 'Annual General Meeting'}</Text>
          <View style={styles.divider} />
          <Text style={styles.detailLabel}>Originally Scheduled</Text>
          <Text style={styles.detailValue}>{date ?? 'January 20, 2025 at 10:00 AM'}</Text>
          {reason ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.detailLabel}>Reason for Cancellation</Text>
              <Text style={styles.detailValue}>{reason}</Text>
            </>
          ) : (
            <>
              <View style={styles.divider} />
              <Text style={styles.detailLabel}>Reason</Text>
              <Text style={styles.detailValue}>Insufficient quorum. A new date will be communicated shortly.</Text>
            </>
          )}
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push('/meetings' as never)}>
          <Text style={styles.primaryBtnText}>Back to Meetings</Text>
        </Pressable>
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
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.secondary.amber, borderRadius: 14, padding: 16, width: '100%' },
  warningText: { color: '#fff', fontWeight: '700', fontSize: 15, flex: 1 },
  iconWrap: { width: 100, height: 100, borderRadius: 50, backgroundColor: colors.secondary.amber + '15', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  mainTitle: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  subTitle: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  detailCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  detailLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600', marginBottom: 2 },
  detailValue: { fontSize: 15, color: colors.neutral.text, fontWeight: '500' },
  divider: { height: 1, backgroundColor: colors.neutral.border, marginVertical: 12 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
