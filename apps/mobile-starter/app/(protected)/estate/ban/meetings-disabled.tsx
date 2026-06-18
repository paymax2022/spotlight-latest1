// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const OUTSTANDING = 2250000;

export default function MeetingsDisabledScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Meeting Access</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons name="people-outline" size={60} color={colors.neutral.placeholder} />
          <View style={styles.warnBadge}><Ionicons name="warning" size={20} color={colors.secondary.amber} /></View>
        </View>
        <View style={styles.yellowBanner}>
          <Ionicons name="warning-outline" size={16} color="#92400e" />
          <Text style={styles.yellowBannerText}>Partial Restriction</Text>
        </View>
        <Text style={styles.title}>Meeting Participation Restricted</Text>
        <Text style={styles.sub}>You can view meetings and discussions, but cannot vote in resolutions until your outstanding dues are settled.</Text>
        <Text style={styles.outstanding}>{fmt(OUTSTANDING)} outstanding</Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: OUTSTANDING, description: 'Outstanding Balance' } } as never)}>
          <Text style={styles.primaryBtnText}>Pay Now to Restore Voting</Text>
        </Pressable>
        <Pressable style={styles.ghostBtn} onPress={() => router.back()}>
          <Text style={styles.ghostBtnText}>View Meetings (Read Only)</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  container: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 14 },
  iconWrap: { position: 'relative', marginBottom: 8 },
  warnBadge: { position: 'absolute', bottom: -6, right: -6, backgroundColor: '#fffbeb', borderRadius: 16, padding: 3 },
  yellowBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fef3c7', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  yellowBannerText: { fontSize: 13, fontWeight: '700', color: '#92400e' },
  title: { fontSize: 20, fontWeight: '700', color: colors.neutral.text, textAlign: 'center' },
  sub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  outstanding: { fontSize: 20, fontWeight: '800', color: colors.secondary.amber },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%', borderWidth: 1.5, borderColor: colors.neutral.border },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted },
});
