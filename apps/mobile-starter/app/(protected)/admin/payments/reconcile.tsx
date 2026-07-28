// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const MONTHS = ['Dec 2024', 'Nov 2024', 'Oct 2024'];
const DISCREPANCIES = [
  { id: '1', resident: 'Emeka Nwosu', expected: 25000, collected: 20000, diff: -5000 },
  { id: '2', resident: 'Mary Obi', expected: 15000, collected: 17000, diff: 2000 },
  { id: '3', resident: 'Ade Bello', expected: 25000, collected: 0, diff: -25000 },
];

export default function Reconcile() {
  const router = useRouter();
  const [month, setMonth] = useState(MONTHS[0]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Reconciliation</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
          {MONTHS.map(m => (
            <Pressable key={m} style={[styles.monthChip, month === m && styles.monthChipActive]} onPress={() => setMonth(m)}>
              <Text style={[styles.monthChipText, month === m && styles.monthChipTextActive]}>{m}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, { backgroundColor: colors.secondary.DEFAULT + '15' }]}>
            <Text style={styles.sumLabel}>Expected</Text>
            <Text style={[styles.sumAmount, { color: colors.secondary.DEFAULT }]}>₦860,000</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.secondary.emerald + '15' }]}>
            <Text style={styles.sumLabel}>Collected</Text>
            <Text style={[styles.sumAmount, { color: colors.secondary.emerald }]}>₦750,000</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.secondary.red + '15' }]}>
            <Text style={styles.sumLabel}>Gap</Text>
            <Text style={[styles.sumAmount, { color: colors.secondary.red }]}>-₦110,000</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Discrepancies ({DISCREPANCIES.length})</Text>
        {DISCREPANCIES.map((item, i) => (
          <View key={item.id} style={styles.discCard}>
            <View style={styles.discTop}>
              <Text style={styles.discName}>{item.resident}</Text>
              <Text style={[styles.discDiff, { color: item.diff < 0 ? colors.secondary.red : colors.secondary.emerald }]}>
                {item.diff < 0 ? '-' : '+'}₦{Math.abs(item.diff).toLocaleString()}
              </Text>
            </View>
            <View style={styles.discDetails}>
              <Text style={styles.discDetailText}>Expected: ₦{item.expected.toLocaleString()}</Text>
              <Text style={styles.discDetailText}>Collected: ₦{item.collected.toLocaleString()}</Text>
            </View>
            <Pressable style={styles.resolveBtn}>
              <Text style={styles.resolveBtnText}>Resolve Discrepancy</Text>
            </Pressable>
          </View>
        ))}
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
  monthChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.neutral.surface, borderWidth: 1, borderColor: colors.neutral.border },
  monthChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  monthChipText: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600' },
  monthChipTextActive: { color: '#fff' },
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryCard: { flex: 1, borderRadius: 12, padding: 12, gap: 4 },
  sumLabel: { fontSize: 11, color: colors.neutral.textMuted },
  sumAmount: { fontSize: 14, fontWeight: '800' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  discCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, gap: 8, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  discTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  discName: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  discDiff: { fontSize: 16, fontWeight: '800' },
  discDetails: { flexDirection: 'row', gap: 16 },
  discDetailText: { fontSize: 12, color: colors.neutral.textMuted },
  resolveBtn: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.secondary.DEFAULT + '15' },
  resolveBtnText: { fontSize: 12, fontWeight: '700', color: colors.secondary.DEFAULT },
});
