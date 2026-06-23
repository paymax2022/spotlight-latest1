// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const DATA_TYPES = ['Residents', 'Payments', 'Visitors', 'Incidents', 'Properties'];
const FORMATS = ['CSV', 'PDF'];

export default function DataExport() {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState('CSV');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [generated, setGenerated] = useState(false);

  const toggleType = (t: string) =>
    setSelected(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Export Data</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>Data Type</Text>
        <View style={styles.chipWrap}>
          {DATA_TYPES.map(t => (
            <Pressable key={t} style={[styles.chip, selected.includes(t) && styles.chipActive]} onPress={() => toggleType(t)}>
              <Text style={[styles.chipText, selected.includes(t) && styles.chipTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Date Range</Text>
        <View style={styles.dateRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.subLabel}>From</Text>
            <TextInput style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.neutral.placeholder} value={from} onChangeText={setFrom} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.subLabel}>To</Text>
            <TextInput style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.neutral.placeholder} value={to} onChangeText={setTo} />
          </View>
        </View>

        <Text style={styles.label}>Format</Text>
        <View style={styles.radioRow}>
          {FORMATS.map(f => (
            <Pressable key={f} style={styles.radioItem} onPress={() => setFormat(f)}>
              <View style={[styles.radioCircle, format === f && styles.radioCircleActive]}>
                {format === f && <View style={styles.radioDot} />}
              </View>
              <Text style={styles.radioLabel}>{f}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => setGenerated(true)}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Generate Export</Text>
        </Pressable>

        {generated && (
          <View style={styles.downloadCard}>
            <Ionicons name="checkmark-circle" size={20} color={colors.secondary.emerald} />
            <View style={{ flex: 1 }}>
              <Text style={styles.downloadTitle}>Export Ready</Text>
              <Text style={styles.downloadSub}>estate-export.{format.toLowerCase()}</Text>
            </View>
            <Pressable>
              <Ionicons name="cloud-download" size={22} color={colors.secondary.DEFAULT} />
            </Pressable>
          </View>
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
  label: { fontSize: 13, fontWeight: '700', color: colors.neutral.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  subLabel: { fontSize: 12, color: colors.neutral.textMuted, marginBottom: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.neutral.surface, borderWidth: 1.5, borderColor: colors.neutral.border },
  chipActive: { backgroundColor: colors.primary.DEFAULT + '15', borderColor: colors.primary.DEFAULT },
  chipText: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600' },
  chipTextActive: { color: colors.primary.DEFAULT },
  dateRow: { flexDirection: 'row', gap: 12 },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  radioRow: { flexDirection: 'row', gap: 20 },
  radioItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  radioCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  radioCircleActive: { borderColor: colors.primary.DEFAULT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary.DEFAULT },
  radioLabel: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  downloadCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.secondary.emerald + '10', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.secondary.emerald + '30' },
  downloadTitle: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  downloadSub: { fontSize: 12, color: colors.neutral.textMuted },
});
