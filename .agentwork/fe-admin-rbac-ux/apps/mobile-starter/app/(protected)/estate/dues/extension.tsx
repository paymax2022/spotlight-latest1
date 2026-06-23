// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const DUE_ITEMS = [
  { id: '1', label: 'Security Levy — PMX-001', amount: 1500000 },
  { id: '2', label: 'Water Bill — PMX-002', amount: 750000 },
];

export default function ExtensionScreen() {
  const router = useRouter();
  const [selectedDue, setSelectedDue] = useState('');
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');

  const handleSubmit = () => {
    if (!selectedDue || !newDate || !reason.trim()) {
      Alert.alert('Incomplete', 'Please fill all fields.');
      return;
    }
    Alert.alert('Request Submitted', 'Your extension request has been submitted. Admin will review within 24 hours.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Request Extension</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="time-outline" size={20} color={colors.secondary.amber} />
          <Text style={styles.infoText}>Extensions are subject to admin approval. Please provide a valid reason for the extension request.</Text>
        </View>

        <Text style={styles.label}>Select Due Item</Text>
        <View style={styles.card}>
          {DUE_ITEMS.map((d, i) => (
            <Pressable
              key={d.id}
              style={[styles.row, i < DUE_ITEMS.length - 1 && styles.listBorder, selectedDue === d.id && styles.rowSelected]}
              onPress={() => setSelectedDue(d.id)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{d.label}</Text>
                <Text style={styles.listSub}>{fmt(d.amount)}</Text>
              </View>
              <View style={[styles.radio, selectedDue === d.id && styles.radioSelected]}>
                {selectedDue === d.id && <View style={styles.radioDot} />}
              </View>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Requested New Date</Text>
        <TextInput
          style={styles.input}
          placeholder="DD/MM/YYYY"
          placeholderTextColor={colors.neutral.placeholder}
          value={newDate}
          onChangeText={setNewDate}
          keyboardType="numbers-and-punctuation"
        />

        <Text style={styles.label}>Reason for Extension</Text>
        <TextInput
          style={styles.textarea}
          placeholder="Explain why you need an extension..."
          placeholderTextColor={colors.neutral.placeholder}
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        <View style={styles.noticeCard}>
          <Ionicons name="information-circle-outline" size={16} color={colors.neutral.textMuted} />
          <Text style={styles.noticeText}>Admin approval required. You will be notified of the decision via push notification and email.</Text>
        </View>

        <Pressable style={styles.primaryBtn} onPress={handleSubmit}>
          <Text style={styles.primaryBtnText}>Submit Request</Text>
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
  infoCard: { backgroundColor: '#fffbeb', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoText: { fontSize: 13, color: '#92400e', flex: 1, lineHeight: 20 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  rowSelected: { backgroundColor: colors.neutral.surfaceAlt },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  textarea: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border, minHeight: 110 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.primary.DEFAULT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary.DEFAULT },
  noticeCard: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  noticeText: { fontSize: 12, color: colors.neutral.textMuted, flex: 1, lineHeight: 18 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
