// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const ORANGE = '#f97316';

export default function SecurityAlert() {
  const router = useRouter();
  const { id, title, body } = useLocalSearchParams<{ id?: string; title?: string; body?: string }>();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Security Alert</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.alertBanner}>
          <Ionicons name="shield-outline" size={28} color={ORANGE} />
          <Text style={styles.bannerText}>Security notice from estate management</Text>
        </View>

        <View style={styles.iconWrap}>
          <Ionicons name="shield-outline" size={56} color={ORANGE} />
        </View>

        <Text style={styles.alertTitle}>{title ?? 'Security Alert'}</Text>
        <Text style={styles.alertBody}>{body ?? 'Please be advised of an ongoing security concern in the estate. Follow the instructions below to stay safe.'}</Text>

        <View style={styles.tipsCard}>
          <Text style={styles.tipsTitle}>Security Tips</Text>
          {['Lock all doors and windows', 'Report suspicious activity to security', 'Do not let in unknown visitors', 'Keep the security contact number handy'].map((tip, i) => (
            <View key={i} style={styles.tipItem}>
              <View style={[styles.tipNum, { backgroundColor: ORANGE + '22' }]}>
                <Text style={[styles.tipNumText, { color: ORANGE }]}>{i + 1}</Text>
              </View>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>

        <Pressable
          style={styles.viewFullBtn}
          onPress={() => id ? router.push(`/announcements/${id}` as never) : router.back()}
        >
          <Ionicons name="document-text-outline" size={18} color="#fff" />
          <Text style={styles.viewFullText}>View Full Alert</Text>
        </Pressable>

        <Pressable style={styles.gotItBtn} onPress={() => router.back()}>
          <Text style={styles.gotItText}>Understood</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: ORANGE },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 20, alignItems: 'center' },
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: ORANGE + '15', borderRadius: 14, padding: 14, width: '100%', borderWidth: 1, borderColor: ORANGE + '30' },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: ORANGE },
  iconWrap: { width: 90, height: 90, borderRadius: 45, backgroundColor: ORANGE + '15', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  alertTitle: { fontSize: 22, fontWeight: '800', color: colors.neutral.text, textAlign: 'center' },
  alertBody: { fontSize: 15, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 24 },
  tipsCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, width: '100%', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  tipsTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text, marginBottom: 4 },
  tipItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tipNum: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tipNumText: { fontSize: 13, fontWeight: '800' },
  tipText: { flex: 1, fontSize: 14, color: colors.neutral.text, lineHeight: 22 },
  viewFullBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ORANGE, borderRadius: 14, height: 50, width: '100%' },
  viewFullText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  gotItBtn: { borderRadius: 14, height: 50, width: '100%', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.neutral.border },
  gotItText: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted },
});
