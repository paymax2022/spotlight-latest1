// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Clipboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const ACCOUNT = { bank: 'Paymax MFB', number: '1234567890', name: 'ESTATE DUES COLLECTION' };

export default function TransferPaymentScreen() {
  const { amount, description } = useLocalSearchParams<{ amount: string; description: string }>();
  const router = useRouter();
  const amountKobo = parseInt(amount ?? '0');

  const copy = (text: string, label: string) => {
    Clipboard.setString(text);
    Alert.alert('Copied!', `${label} copied to clipboard`);
  };

  const STEPS = [
    'Open your banking app or USSD',
    `Transfer exactly ${fmt(amountKobo)} to the account below`,
    'Use your name as the narration',
    'Tap "I\'ve Made the Transfer" below',
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Bank Transfer</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.accountCard}>
          <Text style={styles.accountCardTitle}>Transfer to this account</Text>
          <View style={styles.accountDivider} />
          <View style={styles.accountRow}>
            <Text style={styles.accountLabel}>Bank</Text>
            <Text style={styles.accountValue}>{ACCOUNT.bank}</Text>
          </View>
          <Pressable style={styles.accountRow} onPress={() => copy(ACCOUNT.number, 'Account number')}>
            <Text style={styles.accountLabel}>Account Number</Text>
            <View style={styles.copyRow}>
              <Text style={styles.accountNumberBig}>{ACCOUNT.number}</Text>
              <Ionicons name="copy-outline" size={18} color={colors.primary.DEFAULT} />
            </View>
          </Pressable>
          <View style={styles.accountRow}>
            <Text style={styles.accountLabel}>Account Name</Text>
            <Text style={styles.accountValue}>{ACCOUNT.name}</Text>
          </View>
          <View style={[styles.accountRow, { backgroundColor: '#fff3e0', borderRadius: 10, padding: 10, marginTop: 8 }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.secondary.amber} />
            <Text style={[styles.accountLabel, { color: '#92400e', flex: 1, marginLeft: 6 }]}>Transfer exactly {fmt(amountKobo)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Steps</Text>
        <View style={styles.card}>
          {STEPS.map((step, i) => (
            <View key={i} style={[styles.stepRow, i < STEPS.length - 1 && styles.listBorder]}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push('/estate/dues/pending-confirm' as never)}>
          <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
          <Text style={styles.primaryBtnText}>I've Made the Transfer</Text>
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  accountCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  accountCardTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text, textAlign: 'center' },
  accountDivider: { height: 1, backgroundColor: colors.neutral.border, marginVertical: 4 },
  accountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  accountLabel: { fontSize: 13, color: colors.neutral.textMuted },
  accountValue: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  accountNumberBig: { fontSize: 20, fontWeight: '800', color: colors.primary.DEFAULT, letterSpacing: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 12 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  stepText: { fontSize: 14, color: colors.neutral.text, flex: 1, lineHeight: 20 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
