// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function UploadInvoice() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [uploaded, setUploaded] = useState(false);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Upload Invoice</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.jobSummary}>
          <Text style={styles.jobTitle}>Electrical panel repair</Text>
          <Text style={styles.jobSub}>Green Estate · Job #1042</Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Invoice Amount (₦)</Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="numeric" placeholderTextColor={colors.neutral.placeholder} />
        </View>

        <View style={styles.lineItems}>
          <Text style={styles.label}>Line Items</Text>
          {[
            { desc: 'Materials', amount: 28000 },
            { desc: 'Labor', amount: 17000 },
          ].map((item, i) => (
            <View key={i} style={styles.lineRow}>
              <Text style={styles.lineDesc}>{item.desc}</Text>
              <Text style={styles.lineAmt}>₦{item.amount.toLocaleString()}</Text>
            </View>
          ))}
          <View style={[styles.lineRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmt}>₦45,000</Text>
          </View>
        </View>

        <Pressable style={[styles.uploadBox, uploaded && { borderColor: colors.secondary.emerald }]} onPress={() => setUploaded(true)}>
          {uploaded ? (
            <>
              <Ionicons name="checkmark-circle" size={28} color={colors.secondary.emerald} />
              <Text style={[styles.uploadText, { color: colors.secondary.emerald }]}>Invoice PDF Uploaded</Text>
            </>
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={28} color={colors.neutral.placeholder} />
              <Text style={styles.uploadText}>Upload PDF Invoice</Text>
              <Text style={styles.uploadSub}>Tap to select file</Text>
            </>
          )}
        </Pressable>

        <Pressable style={styles.primaryBtn}>
          <Ionicons name="send" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Submit Invoice</Text>
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
  fieldGroup: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  lineItems: { gap: 8 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  lineDesc: { fontSize: 13, color: colors.neutral.textMuted },
  lineAmt: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  totalRow: { borderBottomWidth: 0 },
  totalLabel: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  totalAmt: { fontSize: 16, fontWeight: '800', color: colors.primary.DEFAULT },
  uploadBox: { height: 100, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 2, borderColor: colors.neutral.border, borderStyle: 'dashed' },
  uploadText: { fontSize: 13, fontWeight: '700', color: colors.neutral.text },
  uploadSub: { fontSize: 11, color: colors.neutral.placeholder },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
