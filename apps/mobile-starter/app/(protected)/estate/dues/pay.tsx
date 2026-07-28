// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const WALLET_BALANCE = 8500000;

const METHODS = [
  { id: 'wallet', label: 'Wallet', icon: 'wallet-outline', sub: `Balance: ${fmt(WALLET_BALANCE)}`, path: '/estate/dues/method/wallet' },
  { id: 'card', label: 'Card', icon: 'card-outline', sub: 'Debit/Credit Card', path: '/estate/dues/method/card' },
  { id: 'transfer', label: 'Bank Transfer', icon: 'swap-horizontal-outline', sub: 'Direct bank transfer', path: '/estate/dues/method/transfer' },
  { id: 'ussd', label: 'USSD', icon: 'keypad-outline', sub: '*737#, *966#, etc.', path: '/estate/dues/method/ussd' },
];

export default function PayScreen() {
  const { amount, description } = useLocalSearchParams<{ amount: string; description: string }>();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const amountKobo = parseInt(amount ?? '0');

  const handleProceed = () => {
    if (!selected) return;
    const method = METHODS.find((m) => m.id === selected);
    if (!method) return;
    router.push({ pathname: method.path, params: { amount, description } } as never);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Make Payment</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>You are paying</Text>
          <Text style={styles.amountValue}>{fmt(amountKobo)}</Text>
          <Text style={styles.amountFor}>For: {description}</Text>
        </View>

        <Text style={styles.sectionTitle}>Select Payment Method</Text>
        {METHODS.map((m) => {
          const isSelected = selected === m.id;
          const isInsufficient = m.id === 'wallet' && amountKobo > WALLET_BALANCE;
          return (
            <Pressable
              key={m.id}
              style={[styles.methodCard, isSelected && styles.methodCardSelected, isInsufficient && styles.methodCardDisabled]}
              onPress={() => !isInsufficient && setSelected(m.id)}
            >
              <View style={[styles.methodIcon, { backgroundColor: isSelected ? colors.primary.DEFAULT : colors.neutral.surfaceAlt }]}>
                <Ionicons name={m.icon as any} size={22} color={isSelected ? '#fff' : colors.primary.DEFAULT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodLabel}>{m.label}</Text>
                <Text style={[styles.methodSub, isInsufficient && { color: colors.secondary.red }]}>
                  {isInsufficient ? 'Insufficient balance' : m.sub}
                </Text>
              </View>
              <View style={[styles.radio, isSelected && styles.radioSelected]}>
                {isSelected && <View style={styles.radioDot} />}
              </View>
            </Pressable>
          );
        })}

        <Pressable
          style={[styles.primaryBtn, !selected && styles.primaryBtnDisabled]}
          onPress={handleProceed}
          disabled={!selected}
        >
          <Text style={styles.primaryBtnText}>Proceed to Pay</Text>
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
  amountCard: { backgroundColor: colors.primary.DEFAULT, borderRadius: 16, padding: 24, alignItems: 'center', gap: 6 },
  amountLabel: { fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  amountValue: { fontSize: 36, fontWeight: '800', color: '#fff' },
  amountFor: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  methodCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: colors.neutral.border, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  methodCardSelected: { borderColor: colors.primary.DEFAULT, backgroundColor: colors.neutral.surfaceAlt },
  methodCardDisabled: { opacity: 0.5 },
  methodIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  methodLabel: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  methodSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.primary.DEFAULT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary.DEFAULT },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
