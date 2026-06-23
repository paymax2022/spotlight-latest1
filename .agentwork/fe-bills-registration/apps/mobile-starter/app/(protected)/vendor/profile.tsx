// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function VendorProfile() {
  const router = useRouter();
  const rating = 4.8;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Profile</Text>
        <Pressable style={styles.backBtn}>
          <Ionicons name="create-outline" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}><Text style={styles.avatarText}>EC</Text></View>
          <Text style={styles.bizName}>Emeka Contractors Ltd.</Text>
          <Text style={styles.bizSub}>Electrical · Plumbing · General</Text>
          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map(i => (
              <Ionicons key={i} name={i <= Math.floor(rating) ? 'star' : 'star-outline'} size={18} color="#C5A059" />
            ))}
            <Text style={styles.ratingText}>{rating}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          {[
            { label: 'Jobs Done', value: '47' },
            { label: 'Response Rate', value: '94%' },
            { label: 'On Time', value: '91%' },
          ].map((s, i) => (
            <View key={i} style={styles.statCard}>
              <Text style={styles.statNum}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          {[
            { label: 'Phone', value: '+234 805 555 6666' },
            { label: 'Email', value: 'emeka@contractors.ng' },
            { label: 'Location', value: 'Lekki, Lagos' },
          ].map((row, i) => (
            <View key={i} style={[styles.infoRow, i < 2 && styles.listBorder]}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Edit Profile</Text>
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
  profileCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 6, shadowColor: '#000', shadowOpacity: 0.06, elevation: 3 },
  avatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.primary.DEFAULT + '20', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  avatarText: { fontSize: 24, fontWeight: '800', color: colors.primary.DEFAULT },
  bizName: { fontSize: 18, fontWeight: '700', color: colors.neutral.text },
  bizSub: { fontSize: 13, color: colors.neutral.textMuted },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  ratingText: { fontSize: 15, fontWeight: '700', color: colors.neutral.text, marginLeft: 4 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOpacity: 0.04, elevation: 1 },
  statNum: { fontSize: 20, fontWeight: '800', color: colors.neutral.text },
  statLabel: { fontSize: 11, color: colors.neutral.textMuted, textAlign: 'center' },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
