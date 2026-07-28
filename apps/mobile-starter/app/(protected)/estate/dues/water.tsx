// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const FLAT_RATE = 750000;
const RATE_PER_UNIT = 50000;

export default function WaterScreen() {
  const router = useRouter();
  const [reading, setReading] = useState('');
  const units = parseInt(reading) || 0;
  const consumptionAmount = units > 0 ? units * RATE_PER_UNIT : FLAT_RATE;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Water Bill</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <View style={styles.iconWrap}><Ionicons name="water-outline" size={32} color={colors.secondary.DEFAULT} /></View>
          <Text style={styles.infoTitle}>Water Bill</Text>
          <Text style={styles.infoAmount}>{fmt(consumptionAmount)}</Text>
          <Text style={styles.infoSub}>{units > 0 ? `${units} units × ${fmt(RATE_PER_UNIT)}` : 'Flat rate'}</Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Meter Number</Text><Text style={styles.value}>WM-2024-0087</Text></View>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Rate per Unit</Text><Text style={styles.value}>{fmt(RATE_PER_UNIT)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Flat Rate</Text><Text style={styles.value}>{fmt(FLAT_RATE)}/mo</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Enter Meter Reading (optional)</Text>
        <View style={styles.inputCard}>
          <TextInput
            style={styles.input}
            placeholder="Enter current reading (units)"
            placeholderTextColor={colors.neutral.placeholder}
            keyboardType="numeric"
            value={reading}
            onChangeText={setReading}
          />
          <Text style={styles.inputHint}>Leave blank to use flat rate billing</Text>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: consumptionAmount, description: 'Water Bill' } } as never)}>
          <Text style={styles.primaryBtnText}>Pay Now — {fmt(consumptionAmount)}</Text>
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
  infoCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  infoTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  infoAmount: { fontSize: 28, fontWeight: '800', color: colors.primary.DEFAULT },
  infoSub: { fontSize: 12, color: colors.neutral.textMuted },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  inputCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  input: { backgroundColor: colors.neutral.background, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  inputHint: { fontSize: 12, color: colors.neutral.textMuted },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
