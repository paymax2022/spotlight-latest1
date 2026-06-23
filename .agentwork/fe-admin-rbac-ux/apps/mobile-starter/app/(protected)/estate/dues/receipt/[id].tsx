// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const amount = 1500000;
  const now = new Date();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Receipt</Text>
        <Pressable style={styles.backBtn} onPress={() => Alert.alert('Share', 'Share coming soon')}>
          <Ionicons name="share-outline" size={22} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.receipt}>
          <View style={styles.receiptHeader}>
            <View style={styles.logo}><Text style={styles.logoText}>PAYMAX</Text></View>
            <View style={styles.verifiedBadge}>
              <Ionicons name="shield-checkmark" size={14} color="#059669" />
              <Text style={styles.verifiedText}>Verified</Text>
            </View>
          </View>

          <View style={styles.divider} />
          <Text style={styles.receiptTitle}>Payment Receipt</Text>

          <View style={styles.amountWrap}>
            <Text style={styles.amountLabel}>Amount Paid</Text>
            <Text style={styles.amountValue}>{fmt(amount)}</Text>
          </View>

          <View style={styles.dividerDashed} />

          <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Receipt No.</Text><Text style={styles.receiptValue}>{id}</Text></View>
          <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Paid To</Text><Text style={styles.receiptValue}>Sunrise Estate</Text></View>
          <View style={styles.receiptRow}><Text style={styles.receiptLabel}>For</Text><Text style={styles.receiptValue}>Security Levy</Text></View>
          <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Date</Text><Text style={styles.receiptValue}>{now.toLocaleDateString('en-NG')}</Text></View>
          <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Time</Text><Text style={styles.receiptValue}>{now.toLocaleTimeString('en-NG')}</Text></View>
          <View style={styles.receiptRow}><Text style={styles.receiptLabel}>Method</Text><Text style={styles.receiptValue}>Wallet</Text></View>

          <View style={styles.divider} />
          <Text style={styles.thankYou}>Thank you for your payment!</Text>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => Alert.alert('Download', 'PDF download coming soon')}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Download PDF</Text>
        </Pressable>
        <Pressable style={styles.ghostBtn} onPress={() => Alert.alert('Share', 'Share coming soon')}>
          <Ionicons name="share-outline" size={18} color={colors.primary.DEFAULT} />
          <Text style={styles.ghostBtnText}>Share</Text>
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
  receipt: { backgroundColor: colors.neutral.surface, borderRadius: 20, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 6 },
  receiptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { backgroundColor: colors.primary.DEFAULT, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  logoText: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 1 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f0fdf4', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  verifiedText: { fontSize: 12, fontWeight: '700', color: '#059669' },
  divider: { height: 1, backgroundColor: colors.neutral.border, marginVertical: 16 },
  dividerDashed: { height: 1, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.neutral.border, marginVertical: 12 },
  receiptTitle: { fontSize: 18, fontWeight: '700', color: colors.neutral.text, textAlign: 'center', marginBottom: 12 },
  amountWrap: { alignItems: 'center', gap: 4, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, padding: 16 },
  amountLabel: { fontSize: 13, color: colors.neutral.textMuted },
  amountValue: { fontSize: 32, fontWeight: '800', color: colors.primary.DEFAULT },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  receiptLabel: { fontSize: 13, color: colors.neutral.textMuted },
  receiptValue: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  thankYou: { fontSize: 13, color: colors.neutral.textMuted, textAlign: 'center' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary.DEFAULT, flexDirection: 'row', gap: 8 },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary.DEFAULT },
});
