// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

export default function DisputeScreen() {
  const router = useRouter();
  const [selectedPayment, setSelectedPayment] = useState('');
  const [reason, setReason] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  const PAYMENTS = [
    { ref: 'PMX-001', label: 'Water Bill — PMX-001' },
    { ref: 'PMX-002', label: 'Security Levy — PMX-002' },
    { ref: 'PMX-003', label: 'Service Charge — PMX-003' },
  ];

  const handleSubmit = () => {
    if (!selectedPayment || !reason.trim()) {
      Alert.alert('Incomplete', 'Please select a payment and provide a reason.');
      return;
    }
    Alert.alert('Dispute Submitted', 'Your dispute has been submitted for review. You will receive a response within 48 hours.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Dispute Payment</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="chatbox-ellipses-outline" size={20} color={colors.secondary.DEFAULT} />
          <Text style={styles.infoText}>Disputes are reviewed within 48 hours. Please provide as much detail as possible.</Text>
        </View>

        <Text style={styles.label}>Select Payment</Text>
        <View style={styles.card}>
          {PAYMENTS.map((p, i) => (
            <Pressable
              key={p.ref}
              style={[styles.row, i < PAYMENTS.length - 1 && styles.listBorder, selectedPayment === p.ref && styles.rowSelected]}
              onPress={() => setSelectedPayment(p.ref)}
            >
              <Text style={styles.listTitle}>{p.label}</Text>
              <View style={[styles.radio, selectedPayment === p.ref && styles.radioSelected]}>
                {selectedPayment === p.ref && <View style={styles.radioDot} />}
              </View>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Dispute Reason</Text>
        <TextInput
          style={styles.textarea}
          placeholder="Describe the issue with this payment..."
          placeholderTextColor={colors.neutral.placeholder}
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />

        <Pressable style={styles.uploadBtn} onPress={() => Alert.alert('Upload', 'Document upload coming soon')}>
          <Ionicons name="attach-outline" size={20} color={colors.primary.DEFAULT} />
          <Text style={styles.uploadBtnText}>Upload Proof (optional)</Text>
        </Pressable>

        <Pressable style={styles.primaryBtn} onPress={handleSubmit}>
          <Text style={styles.primaryBtnText}>Submit Dispute</Text>
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  rowSelected: { backgroundColor: colors.neutral.surfaceAlt },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 14, color: colors.neutral.text, flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.primary.DEFAULT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary.DEFAULT },
  textarea: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border, minHeight: 120 },
  uploadBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1.5, borderColor: colors.neutral.border },
  uploadBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary.DEFAULT },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
