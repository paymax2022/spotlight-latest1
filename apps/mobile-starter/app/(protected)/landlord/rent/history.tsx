// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const HISTORY = [
  { id: '1', tenant: 'James Okafor', unit: 'A1', amount: 120000, date: 'Dec 1, 2024', method: 'Bank Transfer', status: 'Paid' },
  { id: '2', tenant: 'Amaka Eze', unit: 'B3', amount: 80000, date: 'Nov 15, 2024', method: 'Card', status: 'Paid' },
  { id: '3', tenant: 'James Okafor', unit: 'A1', amount: 120000, date: 'Nov 1, 2024', method: 'Bank Transfer', status: 'Paid' },
];

export default function RentHistory() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Payment History</Text>
        <View style={{ width: 38 }} />
      </View>
      <FlatList
        data={HISTORY}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.listRow}>
              <View style={styles.iconWrap}>
                <Ionicons name="checkmark-circle" size={20} color={colors.secondary.emerald} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{item.tenant} · Unit {item.unit}</Text>
                <Text style={styles.listSub}>{item.date} · {item.method}</Text>
              </View>
              <Text style={styles.amount}>₦{item.amount.toLocaleString()}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  listContent: { padding: 16 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, elevation: 1 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.secondary.emerald + '15', alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '800', color: colors.secondary.emerald },
});
