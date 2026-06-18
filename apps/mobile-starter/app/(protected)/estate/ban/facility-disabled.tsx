// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const OUTSTANDING = 2250000;

export default function FacilityDisabledScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Facility Disabled</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={styles.container}>
        <View style={styles.lockOverlay}>
          <Ionicons name="fitness-outline" size={60} color={colors.neutral.placeholder} />
          <View style={styles.lockBadge}><Ionicons name="lock-closed" size={28} color={colors.secondary.red} /></View>
        </View>
        <Text style={styles.title}>Facility Booking Disabled</Text>
        <Text style={styles.sub}>Your Facility access is disabled until outstanding dues are settled.</Text>
        <Text style={styles.outstanding}>{fmt(OUTSTANDING)} outstanding</Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: OUTSTANDING, description: 'Outstanding Balance' } } as never)}>
          <Text style={styles.primaryBtnText}>Pay Now to Restore</Text>
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
  container: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 16 },
  lockOverlay: { position: 'relative', marginBottom: 8 },
  lockBadge: { position: 'absolute', bottom: -8, right: -8, backgroundColor: '#fef2f2', borderRadius: 20, padding: 4 },
  title: { fontSize: 20, fontWeight: '700', color: colors.neutral.text, textAlign: 'center' },
  sub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 22, maxWidth: 280 },
  outstanding: { fontSize: 20, fontWeight: '800', color: colors.secondary.red },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
