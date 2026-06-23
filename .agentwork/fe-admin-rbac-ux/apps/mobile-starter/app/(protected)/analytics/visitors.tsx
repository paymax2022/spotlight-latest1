// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function Screen() {
  const router = useRouter();
  const BARS = [0.5, 0.7, 0.6, 0.9, 0.8, 1.0, 0.75];
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Visitor Analytics</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statsRow}>
          {[
            { l: 'This Month', v: '342' },
            { l: 'vs Last Month', v: '+12%' },
            { l: 'This Week', v: '84' },
            { l: 'Today', v: '11' },
          ].map((s, i) => (
            <View key={i} style={styles.statCard}>
              <Text style={styles.statNum}>{s.v}</Text>
              <Text style={styles.statLabel}>{s.l}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.sectionTitle}>Weekly Trend</Text>
        <View style={styles.card}>
          <View style={styles.barChart}>
            {BARS.map((h, i) => (
              <View key={i} style={styles.barItem}>
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { height: `${h * 100}%` }]} />
                </View>
                <Text style={styles.barLabel}>{['M','T','W','T','F','S','S'][i]}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.infoCard}>
          <Ionicons name="analytics-outline" size={18} color={colors.secondary.DEFAULT} />
          <Text style={styles.infoText}>Detailed charts and filters coming soon.</Text>
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
  content: { padding: 20, gap: 16 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { width: '47%', backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 12, alignItems: 'center', gap: 4 },
  statNum: { fontSize: 20, fontWeight: '800', color: colors.neutral.text },
  statLabel: { fontSize: 11, color: colors.neutral.textMuted },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', height: 120, padding: 16 },
  barItem: { alignItems: 'center', gap: 6, flex: 1 },
  barTrack: { width: 24, height: 90, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 6, justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.primary.DEFAULT, borderRadius: 6 },
  barLabel: { fontSize: 11, color: colors.neutral.textMuted },
  infoCard: { flexDirection: 'row', gap: 10, backgroundColor: colors.secondary.DEFAULT + '10', borderRadius: 12, padding: 14, alignItems: 'center' },
  infoText: { flex: 1, fontSize: 13, color: colors.neutral.text },
});

