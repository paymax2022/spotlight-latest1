// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const BANKS = [
  { id: 'gtbank', name: 'GTBank', ussd: '*737#' },
  { id: 'access', name: 'Access Bank', ussd: '*901#' },
  { id: 'zenith', name: 'Zenith Bank', ussd: '*966#' },
  { id: 'firstbank', name: 'First Bank', ussd: '*894#' },
  { id: 'uba', name: 'UBA', ussd: '*919#' },
];

export default function USSDPaymentScreen() {
  const { amount } = useLocalSearchParams<{ amount: string }>();
  const router = useRouter();
  const amountKobo = parseInt(amount ?? '0');
  const [selected, setSelected] = useState<string | null>(null);

  const bank = BANKS.find((b) => b.id === selected);

  const handleDial = () => {
    if (!bank) return;
    Linking.openURL(`tel:${bank.ussd.replace('#', encodeURIComponent('#'))}`);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>USSD Payment</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="keypad-outline" size={32} color={colors.primary.DEFAULT} />
          <Text style={styles.infoTitle}>Pay via USSD</Text>
          <Text style={styles.infoAmount}>{fmt(amountKobo)}</Text>
        </View>

        <Text style={styles.sectionTitle}>Select Your Bank</Text>
        <View style={styles.card}>
          {BANKS.map((b, i) => (
            <Pressable
              key={b.id}
              style={[styles.bankRow, i < BANKS.length - 1 && styles.listBorder, selected === b.id && styles.bankRowSelected]}
              onPress={() => setSelected(b.id)}
            >
              <View style={styles.bankInitial}><Text style={styles.bankInitialText}>{b.name[0]}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{b.name}</Text>
                <Text style={styles.listSub}>{b.ussd}</Text>
              </View>
              <View style={[styles.radio, selected === b.id && styles.radioSelected]}>
                {selected === b.id && <View style={styles.radioDot} />}
              </View>
            </Pressable>
          ))}
        </View>

        {bank && (
          <View style={styles.ussdCard}>
            <Text style={styles.ussdLabel}>Dial this code</Text>
            <Text style={styles.ussdCode}>{bank.ussd}</Text>
            <Text style={styles.ussdHint}>Follow the prompts to complete payment of {fmt(amountKobo)}</Text>
          </View>
        )}

        <Pressable
          style={[styles.primaryBtn, !selected && styles.primaryBtnDisabled]}
          onPress={handleDial}
          disabled={!selected}
        >
          <Ionicons name="call-outline" size={20} color="#fff" />
          <Text style={styles.primaryBtnText}>Dial Now{bank ? ` — ${bank.ussd}` : ''}</Text>
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
  infoCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  infoTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  infoAmount: { fontSize: 24, fontWeight: '800', color: colors.primary.DEFAULT },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  bankRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  bankRowSelected: { backgroundColor: colors.neutral.surfaceAlt },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  bankInitial: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  bankInitialText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.primary.DEFAULT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary.DEFAULT },
  ussdCard: { backgroundColor: colors.primary.DEFAULT, borderRadius: 16, padding: 20, alignItems: 'center', gap: 6 },
  ussdLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  ussdCode: { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: 2 },
  ussdHint: { fontSize: 12, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
