// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useRef, useState } from 'react';
import { TextInput } from 'react-native';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const WALLET_BALANCE = 8500000;

export default function WalletPaymentScreen() {
  const { amount, description } = useLocalSearchParams<{ amount: string; description: string }>();
  const router = useRouter();
  const amountKobo = parseInt(amount ?? '0');
  const insufficient = amountKobo > WALLET_BALANCE;
  const [pin, setPin] = useState(['', '', '', '']);
  const refs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  const handlePinChange = (val: string, idx: number) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const newPin = [...pin];
    newPin[idx] = digit;
    setPin(newPin);
    if (digit && idx < 3) refs[idx + 1].current?.focus();
    if (!digit && idx > 0) refs[idx - 1].current?.focus();
  };

  const handleConfirm = () => {
    if (pin.some((d) => d === '')) { Alert.alert('PIN Required', 'Please enter your 4-digit PIN'); return; }
    router.push('/estate/dues/processing' as never);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Wallet Payment</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Wallet Balance</Text>
          <Text style={[styles.balanceValue, insufficient && { color: colors.secondary.red }]}>{fmt(WALLET_BALANCE)}</Text>
          {insufficient && (
            <View style={styles.warnBadge}>
              <Ionicons name="warning-outline" size={14} color="#92400e" />
              <Text style={styles.warnText}>Insufficient balance</Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}>
            <Text style={styles.label}>Amount to debit</Text>
            <Text style={[styles.value, { color: colors.primary.DEFAULT, fontWeight: '700' }]}>{fmt(amountKobo)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>For</Text>
            <Text style={styles.value}>{description}</Text>
          </View>
        </View>

        {!insufficient && (
          <>
            <Text style={styles.sectionTitle}>Enter PIN</Text>
            <View style={styles.pinContainer}>
              {pin.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={refs[i]}
                  style={[styles.pinBox, digit && styles.pinBoxFilled]}
                  value={digit ? '•' : ''}
                  onChangeText={(v) => handlePinChange(v, i)}
                  keyboardType="numeric"
                  maxLength={1}
                  secureTextEntry
                />
              ))}
            </View>
          </>
        )}

        <Pressable
          style={[styles.primaryBtn, insufficient && styles.primaryBtnDisabled]}
          onPress={handleConfirm}
          disabled={insufficient}
        >
          <Text style={styles.primaryBtnText}>Confirm Payment</Text>
        </Pressable>

        {insufficient && (
          <Pressable style={styles.ghostBtn} onPress={() => router.back()}>
            <Text style={styles.ghostBtnText}>Choose another method</Text>
          </Pressable>
        )}
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
  balanceCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  balanceLabel: { fontSize: 13, color: colors.neutral.textMuted },
  balanceValue: { fontSize: 28, fontWeight: '800', color: colors.secondary.emerald },
  warnBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fef3c7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  warnText: { fontSize: 12, color: '#92400e', fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  pinContainer: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  pinBox: { width: 60, height: 60, borderRadius: 14, borderWidth: 2, borderColor: colors.neutral.border, backgroundColor: colors.neutral.surface, fontSize: 24, textAlign: 'center', fontWeight: '700', color: colors.primary.DEFAULT },
  pinBoxFilled: { borderColor: colors.primary.DEFAULT, backgroundColor: colors.neutral.surfaceAlt },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary.DEFAULT },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary.DEFAULT },
});
