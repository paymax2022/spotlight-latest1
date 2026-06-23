// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function SubmitQuote() {
  const router = useRouter();
  const [materials, setMaterials] = useState([{ item: '', cost: '' }]);
  const [labor, setLabor] = useState('');
  const [notes, setNotes] = useState('');

  const addRow = () => setMaterials(m => [...m, { item: '', cost: '' }]);
  const removeRow = (i: number) => setMaterials(m => m.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: string, val: string) =>
    setMaterials(m => m.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

  const matTotal = materials.reduce((sum, m) => sum + (parseFloat(m.cost) || 0), 0);
  const laborAmt = parseFloat(labor) || 0;
  const total = matTotal + laborAmt;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Submit Quote</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.jobSummary}>
          <Text style={styles.jobTitle}>Job: Electrical panel repair</Text>
          <Text style={styles.jobSub}>Green Estate · Job #1042</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Materials</Text>
          <Pressable onPress={addRow}>
            <Ionicons name="add-circle" size={22} color={colors.primary.DEFAULT} />
          </Pressable>
        </View>
        {materials.map((row, i) => (
          <View key={i} style={styles.matRow}>
            <TextInput style={[styles.input, { flex: 2 }]} value={row.item} onChangeText={v => updateRow(i, 'item', v)} placeholder="Item" placeholderTextColor={colors.neutral.placeholder} />
            <TextInput style={[styles.input, { flex: 1 }]} value={row.cost} onChangeText={v => updateRow(i, 'cost', v)} placeholder="₦ Cost" keyboardType="numeric" placeholderTextColor={colors.neutral.placeholder} />
            {materials.length > 1 && (
              <Pressable onPress={() => removeRow(i)}>
                <Ionicons name="close-circle" size={22} color={colors.secondary.red} />
              </Pressable>
            )}
          </View>
        ))}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Labor Cost (₦)</Text>
          <TextInput style={styles.input} value={labor} onChangeText={setLabor} placeholder="0" keyboardType="numeric" placeholderTextColor={colors.neutral.placeholder} />
        </View>

        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Total Quote</Text>
          <Text style={styles.totalAmount}>₦{total.toLocaleString()}</Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Notes</Text>
          <TextInput style={[styles.input, styles.textarea]} value={notes} onChangeText={setNotes} placeholder="Additional notes about materials or timeline..." placeholderTextColor={colors.neutral.placeholder} multiline numberOfLines={4} textAlignVertical="top" />
        </View>

        <Pressable style={styles.primaryBtn}>
          <Ionicons name="send" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Submit Quote</Text>
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
  jobSummary: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14 },
  jobTitle: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  jobSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  matRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  fieldGroup: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  textarea: { height: 100, paddingTop: 14 },
  totalCard: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  totalAmount: { fontSize: 22, fontWeight: '800', color: '#fff' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
