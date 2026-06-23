// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const OUTSTANDING = 2250000;
const SOFT_RESTRICTIONS = ['Community posts', 'Facility booking'];

export default function BanWarningScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.orangeBanner}>
        <Ionicons name="warning" size={18} color="#fff" />
        <Text style={styles.bannerText}>Payment Due — Please settle your outstanding balance</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Payment Due</Text>
          <Text style={styles.outstandingAmount}>{fmt(OUTSTANDING)}</Text>
          <Text style={styles.outstandingSub}>Outstanding balance</Text>
        </View>

        <Text style={styles.sectionTitle}>Currently Restricted</Text>
        <View style={styles.restrictionCard}>
          {SOFT_RESTRICTIONS.map((r, i) => (
            <View key={r} style={[styles.restrictionRow, i < SOFT_RESTRICTIONS.length - 1 && styles.listBorder]}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.secondary.amber} />
              <Text style={styles.restrictionText}>{r}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: OUTSTANDING, description: 'Outstanding Balance' } } as never)}>
          <Text style={styles.primaryBtnText}>Pay Now — {fmt(OUTSTANDING)}</Text>
        </Pressable>
        <Pressable style={styles.dismissBtn} onPress={() => router.back()}>
          <Text style={styles.dismissText}>Dismiss for now</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  orangeBanner: { backgroundColor: '#f59e0b', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  bannerText: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  content: { padding: 20, gap: 16 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted },
  outstandingAmount: { fontSize: 36, fontWeight: '800', color: colors.secondary.red },
  outstandingSub: { fontSize: 13, color: colors.neutral.textMuted },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  restrictionCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  restrictionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  restrictionText: { fontSize: 14, color: colors.neutral.text },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  dismissBtn: { alignItems: 'center', padding: 12 },
  dismissText: { fontSize: 14, color: colors.neutral.textMuted, textDecorationLine: 'underline' },
});
