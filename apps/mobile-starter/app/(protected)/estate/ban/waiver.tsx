// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

const WAIVER_TYPES = [
  { id: 'hardship', label: 'Financial Hardship' },
  { id: 'medical', label: 'Medical Emergency' },
  { id: 'dispute', label: 'Dispute / Error' },
];

export default function WaiverScreen() {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState('');
  const [reason, setReason] = useState('');

  const handleSubmit = () => {
    if (!selectedType || !reason.trim()) { Alert.alert('Incomplete', 'Please select a waiver type and provide a reason.'); return; }
    Alert.alert('Request Submitted', 'Your waiver request has been submitted. Admin will review within 48 hours.', [{ text: 'OK', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Request Waiver</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="shield-outline" size={20} color={colors.secondary.DEFAULT} />
          <Text style={styles.infoText}>Waiver requests are reviewed by the estate committee. Admin approval required within 48 hours.</Text>
        </View>

        <Text style={styles.sectionTitle}>Waiver Type</Text>
        <View style={styles.chipsRow}>
          {WAIVER_TYPES.map((t) => (
            <Pressable
              key={t.id}
              style={[styles.chip, selectedType === t.id && styles.chipSelected]}
              onPress={() => setSelectedType(t.id)}
            >
              <Text style={[styles.chipText, selectedType === t.id && styles.chipTextSelected]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Reason / Explanation</Text>
        <TextInput
          style={styles.textarea}
          placeholder="Provide details about your situation..."
          placeholderTextColor={colors.neutral.placeholder}
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />

        <Pressable style={styles.uploadBtn} onPress={() => Alert.alert('Upload', 'Document upload coming soon')}>
          <Ionicons name="document-attach-outline" size={20} color={colors.primary.DEFAULT} />
          <Text style={styles.uploadBtnText}>Upload Supporting Documents</Text>
        </Pressable>

        <View style={styles.noticeCard}>
          <Ionicons name="information-circle-outline" size={16} color={colors.neutral.textMuted} />
          <Text style={styles.noticeText}>Admin approval required within 48h. You will be notified via push notification and email.</Text>
        </View>

        <Pressable style={styles.primaryBtn} onPress={handleSubmit}>
          <Text style={styles.primaryBtnText}>Submit Waiver Request</Text>
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
  infoCard: { backgroundColor: '#eff6ff', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoText: { fontSize: 13, color: colors.secondary.DEFAULT, flex: 1, lineHeight: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: colors.neutral.border, backgroundColor: colors.neutral.surface },
  chipSelected: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  chipTextSelected: { color: '#fff' },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  textarea: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border, minHeight: 120 },
  uploadBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1.5, borderColor: colors.neutral.border },
  uploadBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary.DEFAULT },
  noticeCard: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8 },
  noticeText: { fontSize: 12, color: colors.neutral.textMuted, flex: 1, lineHeight: 18 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
