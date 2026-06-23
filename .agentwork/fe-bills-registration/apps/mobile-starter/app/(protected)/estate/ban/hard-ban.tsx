// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const OUTSTANDING = 5750000;

const ALL_FEATURES = ['Community posts', 'Facility booking', 'Visitor access', 'Voting & elections', 'Meeting participation', 'Repair requests', 'Estate events', 'Document access'];

export default function HardBanScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: '#fff5f5' }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.banIcon}>
          <Ionicons name="ban" size={80} color={colors.secondary.red} />
        </View>
        <Text style={styles.title}>Access Restricted</Text>
        <Text style={styles.outstandingAmount}>{fmt(OUTSTANDING)}</Text>
        <Text style={styles.outstandingSub}>Outstanding balance</Text>

        <Text style={styles.sectionTitle}>Disabled Features</Text>
        <View style={styles.card}>
          {ALL_FEATURES.map((f, i) => (
            <View key={f} style={[styles.row, i < ALL_FEATURES.length - 1 && styles.listBorder]}>
              <Ionicons name="lock-closed" size={16} color={colors.secondary.red} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: OUTSTANDING, description: 'All Outstanding Dues' } } as never)}>
          <Text style={styles.primaryBtnText}>Pay Now to Restore Access</Text>
        </Pressable>
        <Pressable style={styles.ghostBtn} onPress={() => router.push('/support' as never)}>
          <Text style={styles.ghostBtnText}>Contact Support</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff5f5' },
  content: { padding: 24, alignItems: 'center', gap: 12 },
  banIcon: { marginTop: 32 },
  title: { fontSize: 28, fontWeight: '800', color: colors.secondary.red, textAlign: 'center' },
  outstandingAmount: { fontSize: 40, fontWeight: '800', color: colors.secondary.red },
  outstandingSub: { fontSize: 14, color: colors.neutral.textMuted },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text, alignSelf: 'flex-start', marginTop: 8 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  featureText: { fontSize: 14, color: colors.neutral.text },
  primaryBtn: { backgroundColor: colors.secondary.red, borderRadius: 14, height: 54, alignItems: 'center', justifyContent: 'center', width: '100%' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%', borderWidth: 1.5, borderColor: colors.neutral.border },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted },
});
