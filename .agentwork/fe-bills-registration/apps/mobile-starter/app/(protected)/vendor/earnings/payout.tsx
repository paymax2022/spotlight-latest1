// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function RequestPayout() {
  const router = useRouter();
  const [amount, setAmount] = useState('');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Request Payout</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.balCard}>
          <Text style={styles.balLabel}>Available for Payout</Text>
          <Text style={styles.balAmount}>₦45,000</Text>
        </View>

        <View style={styles.bankCard}>
          <View style={styles.bankIcon}><Ionicons name="business" size={20} color={colors.primary.DEFAULT} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.listTitle}>Zenith Bank</Text>
            <Text style={styles.listSub}>**** **** **** 4521 · Emeka Contractors</Text>
          </View>
          <Pressable><Text style={styles.changeText}>Change</Text></Pressable>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Amount to Withdraw (₦)</Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="Enter amount" keyboardType="numeric" placeholderTextColor={colors.neutral.placeholder} />
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="time-outline" size={18} color={colors.secondary.amber} />
          <Text style={styles.infoText}>Payouts are processed within 1–2 business days after approval.</Text>
        </View>

        <Pressable style={styles.primaryBtn}>
          <Ionicons name="arrow-up-circle" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Request Payout</Text>
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
  balCard: { backgroundColor: colors.primary.DEFAULT, borderRadius: 16, padding: 20, gap: 4 },
  balLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  balAmount: { fontSize: 28, fontWeight: '800', color: '#fff' },
  bankCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, shadowColor: '#000', shadowOpacity: 0.04, elevation: 1 },
  bankIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  changeText: { fontSize: 13, fontWeight: '700', color: colors.secondary.DEFAULT },
  fieldGroup: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  infoCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.secondary.amber + '15', borderRadius: 12, padding: 14 },
  infoText: { flex: 1, fontSize: 13, color: colors.neutral.text, lineHeight: 20 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
