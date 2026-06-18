// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function ProofApprovedScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: '#f0fdf4' }]}>
      <View style={styles.container}>
        <View style={styles.icon}><Ionicons name="shield-checkmark" size={80} color={colors.secondary.emerald} /></View>
        <Text style={styles.title}>Proof Approved!</Text>
        <Text style={styles.sub}>Your payment proof has been verified by estate admin.</Text>
        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}>
            <Text style={styles.label}>Verification Status</Text>
            <View style={styles.approvedBadge}><Text style={styles.approvedBadgeText}>Approved</Text></View>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Access Restoration</Text>
            <Text style={styles.value}>Within 5 minutes</Text>
          </View>
        </View>
        <Text style={styles.hint}>Your access restrictions will be lifted automatically. If access is not restored within 10 minutes, contact support.</Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.push('/estate/ban/restore-pending' as never)}>
          <Text style={styles.primaryBtnText}>Check Restoration Status</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 14 },
  icon: { marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: colors.secondary.emerald },
  sub: { fontSize: 15, color: '#166534', textAlign: 'center', lineHeight: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: '#dcfce7' },
  label: { fontSize: 13, color: '#166534', opacity: 0.8 },
  value: { fontSize: 14, fontWeight: '600', color: '#166534' },
  approvedBadge: { backgroundColor: '#dcfce7', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  approvedBadgeText: { fontSize: 11, fontWeight: '700', color: '#166534' },
  hint: { fontSize: 12, color: '#166534', textAlign: 'center', opacity: 0.7, lineHeight: 18 },
  primaryBtn: { backgroundColor: colors.secondary.emerald, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
