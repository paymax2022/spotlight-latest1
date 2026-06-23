// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const CODE_TYPES = ['One-Time Code', 'Recurring Code', 'Delivery Code', 'Service Code'];

export default function VisitorRules() {
  const router = useRouter();
  const [maxCodes, setMaxCodes] = useState('5');
  const [maxDuration, setMaxDuration] = useState('72');
  const [allowedTypes, setAllowedTypes] = useState<string[]>(['One-Time Code', 'Delivery Code']);

  const toggleType = (t: string) =>
    setAllowedTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Visitor Rules</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Max Active Codes per Resident</Text>
            <TextInput style={styles.input} value={maxCodes} onChangeText={setMaxCodes} keyboardType="numeric" />
          </View>
          <View style={[styles.fieldWrap, { borderTopWidth: 1, borderTopColor: colors.neutral.border }]}>
            <Text style={styles.label}>Max Code Validity (hours)</Text>
            <TextInput style={styles.input} value={maxDuration} onChangeText={setMaxDuration} keyboardType="numeric" />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Allowed Code Types</Text>
        <View style={styles.card}>
          {CODE_TYPES.map((t, i) => (
            <Pressable key={t} style={[styles.checkRow, i < CODE_TYPES.length - 1 && styles.listBorder]} onPress={() => toggleType(t)}>
              <View style={[styles.checkbox, allowedTypes.includes(t) && styles.checkboxActive]}>
                {allowedTypes.includes(t) && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
              <Text style={styles.listTitle}>{t}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Save Rules</Text>
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
  fieldWrap: { padding: 14, gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 12, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
