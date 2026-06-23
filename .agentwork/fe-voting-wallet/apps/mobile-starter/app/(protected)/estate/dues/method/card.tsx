// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const SAVED_CARDS = [
  { id: '1', last4: '4242', brand: 'Visa', expiry: '12/26' },
  { id: '2', last4: '5311', brand: 'Mastercard', expiry: '09/25' },
];

export default function CardPaymentScreen() {
  const { amount, description } = useLocalSearchParams<{ amount: string; description: string }>();
  const router = useRouter();
  const amountKobo = parseInt(amount ?? '0');
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');

  const formatCard = (v: string) => v.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, 19);
  const formatExpiry = (v: string) => { const d = v.replace(/\D/g, ''); return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2, 4) : d; };

  const handlePay = () => {
    router.push('/estate/dues/processing' as never);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Card Payment</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {SAVED_CARDS.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Saved Cards</Text>
            <View style={styles.card}>
              {SAVED_CARDS.map((c, i) => (
                <Pressable
                  key={c.id}
                  style={[styles.cardRow, i < SAVED_CARDS.length - 1 && styles.listBorder, selectedCard === c.id && styles.cardRowSelected]}
                  onPress={() => setSelectedCard(c.id)}
                >
                  <View style={styles.cardBrandIcon}>
                    <Ionicons name="card-outline" size={20} color={colors.primary.DEFAULT} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listTitle}>{c.brand} •••• {c.last4}</Text>
                    <Text style={styles.listSub}>Expires {c.expiry}</Text>
                  </View>
                  <View style={[styles.radio, selectedCard === c.id && styles.radioSelected]}>
                    {selectedCard === c.id && <View style={styles.radioDot} />}
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>New Card</Text>
        <View style={styles.formCard}>
          <Text style={styles.label}>Card Number</Text>
          <TextInput style={styles.input} placeholder="0000 0000 0000 0000" placeholderTextColor={colors.neutral.placeholder} keyboardType="numeric" value={cardNumber} onChangeText={(v) => setCardNumber(formatCard(v))} maxLength={19} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Expiry</Text>
              <TextInput style={styles.input} placeholder="MM/YY" placeholderTextColor={colors.neutral.placeholder} keyboardType="numeric" value={expiry} onChangeText={(v) => setExpiry(formatExpiry(v))} maxLength={5} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>CVV</Text>
              <TextInput style={styles.input} placeholder="•••" placeholderTextColor={colors.neutral.placeholder} keyboardType="numeric" value={cvv} onChangeText={setCvv} maxLength={4} secureTextEntry />
            </View>
          </View>
        </View>

        <Pressable style={styles.primaryBtn} onPress={handlePay}>
          <Text style={styles.primaryBtnText}>Pay {fmt(amountKobo)}</Text>
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
  formCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  cardRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  cardRowSelected: { backgroundColor: colors.neutral.surfaceAlt },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  cardBrandIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.primary.DEFAULT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary.DEFAULT },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, marginBottom: 6 },
  input: { backgroundColor: colors.neutral.background, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
