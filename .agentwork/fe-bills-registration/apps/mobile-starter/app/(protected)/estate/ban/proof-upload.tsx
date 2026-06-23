// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

export default function ProofUploadScreen() {
  const router = useRouter();
  const [bankName, setBankName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [reference, setReference] = useState('');
  const [photoAdded, setPhotoAdded] = useState(false);

  const handleSubmit = () => {
    if (!bankName || !amount || !date || !reference) {
      Alert.alert('Incomplete', 'Please fill all fields.');
      return;
    }
    router.push('/estate/ban/proof-review' as never);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Upload Proof of Payment</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>Bank Name</Text>
        <TextInput style={styles.input} placeholder="e.g. GTBank" placeholderTextColor={colors.neutral.placeholder} value={bankName} onChangeText={setBankName} />

        <Text style={styles.label}>Amount Paid</Text>
        <TextInput style={styles.input} placeholder="e.g. 15,000" placeholderTextColor={colors.neutral.placeholder} value={amount} onChangeText={setAmount} keyboardType="numeric" />

        <Text style={styles.label}>Date of Payment</Text>
        <TextInput style={styles.input} placeholder="DD/MM/YYYY" placeholderTextColor={colors.neutral.placeholder} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />

        <Text style={styles.label}>Reference / Transaction ID</Text>
        <TextInput style={styles.input} placeholder="e.g. TRF20240618001" placeholderTextColor={colors.neutral.placeholder} value={reference} onChangeText={setReference} />

        <Text style={styles.label}>Upload Screenshot / Receipt</Text>
        <Pressable style={[styles.uploadArea, photoAdded && styles.uploadAreaDone]} onPress={() => { setPhotoAdded(true); Alert.alert('Photo Added', 'Screenshot selected (placeholder)'); }}>
          <Ionicons name={photoAdded ? 'image' : 'camera-outline'} size={32} color={photoAdded ? colors.secondary.emerald : colors.neutral.placeholder} />
          <Text style={[styles.uploadText, photoAdded && { color: colors.secondary.emerald }]}>
            {photoAdded ? 'Photo Added ✓' : 'Tap to add screenshot or photo'}
          </Text>
        </Pressable>

        <Pressable style={styles.primaryBtn} onPress={handleSubmit}>
          <Text style={styles.primaryBtnText}>Submit Proof</Text>
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
  content: { padding: 20, gap: 14 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  uploadArea: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 24, alignItems: 'center', gap: 10, borderWidth: 2, borderColor: colors.neutral.border, borderStyle: 'dashed' },
  uploadAreaDone: { borderColor: colors.secondary.emerald, backgroundColor: '#f0fdf4' },
  uploadText: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
