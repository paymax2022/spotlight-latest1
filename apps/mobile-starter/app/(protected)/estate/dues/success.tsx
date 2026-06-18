// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

export default function PaymentSuccessScreen() {
  const { amount, reference } = useLocalSearchParams<{ amount?: string; reference?: string }>();
  const router = useRouter();
  const amountKobo = parseInt(amount ?? '1500000');
  const ref = reference ?? 'PMX-' + Date.now();
  const now = new Date();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark-circle" size={80} color="#10B981" />
        </View>
        <Text style={styles.title}>Payment Successful!</Text>
        <Text style={styles.sub}>Your payment has been processed.</Text>

        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}>
            <Text style={styles.label}>Amount Paid</Text>
            <Text style={[styles.value, { color: colors.secondary.emerald, fontWeight: '700' }]}>{fmt(amountKobo)}</Text>
          </View>
          <View style={[styles.row, styles.listBorder]}>
            <Text style={styles.label}>Reference</Text>
            <Text style={styles.value}>{ref}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Date & Time</Text>
            <Text style={styles.value}>{now.toLocaleString('en-NG')}</Text>
          </View>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/receipt/[id]', params: { id: ref } } as never)}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Download Receipt</Text>
        </Pressable>

        <Pressable style={styles.ghostBtn} onPress={() => router.push('/estate/dues' as never)}>
          <Text style={styles.ghostBtnText}>Back to Dues</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  content: { padding: 24, gap: 16, alignItems: 'center' },
  successIcon: { marginTop: 40, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: colors.neutral.text, textAlign: 'center' },
  sub: { fontSize: 15, color: colors.neutral.textMuted, textAlign: 'center' },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, width: '100%' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, width: '100%' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary.DEFAULT, width: '100%' },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary.DEFAULT },
});
