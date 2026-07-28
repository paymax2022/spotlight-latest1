// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const FEATURES = [
  { label: 'View Estate Info', icon: 'home-outline', available: true },
  { label: 'View Own Profile', icon: 'person-outline', available: true },
  { label: 'View Meeting Agendas', icon: 'document-text-outline', available: true },
  { label: 'Community Posts', icon: 'chatbubbles-outline', available: false },
  { label: 'Facility Booking', icon: 'fitness-outline', available: false },
  { label: 'Visitor Management', icon: 'qr-code-outline', available: false },
  { label: 'Voting & Elections', icon: 'checkbox-outline', available: false },
  { label: 'Repair Requests', icon: 'build-outline', available: false },
];

export default function LimitedProfileScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Limited Access Mode</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.banner}>
          <Ionicons name="shield-outline" size={20} color={colors.secondary.amber} />
          <Text style={styles.bannerText}>Your account is in limited access mode due to outstanding dues.</Text>
        </View>

        <Text style={styles.sectionTitle}>Feature Access</Text>
        <View style={styles.card}>
          {FEATURES.map((f, i) => (
            <View key={f.label} style={[styles.row, i < FEATURES.length - 1 && styles.listBorder]}>
              <View style={[styles.iconCircle, { backgroundColor: f.available ? '#f0fdf4' : '#fef2f2' }]}>
                <Ionicons name={f.icon as any} size={18} color={f.available ? colors.secondary.emerald : colors.secondary.red} />
              </View>
              <Text style={[styles.listTitle, !f.available && { color: colors.neutral.textMuted }]}>{f.label}</Text>
              <Ionicons
                name={f.available ? 'checkmark-circle' : 'lock-closed'}
                size={18}
                color={f.available ? colors.secondary.emerald : colors.secondary.red}
              />
            </View>
          ))}
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push('/estate/dues' as never)}>
          <Text style={styles.primaryBtnText}>Clear Dues to Restore Access</Text>
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
  content: { padding: 20, gap: 16 },
  banner: { backgroundColor: '#fffbeb', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bannerText: { fontSize: 13, color: '#92400e', flex: 1, lineHeight: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text, flex: 1 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
