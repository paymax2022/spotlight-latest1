// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const TOTAL_STEPS = 4;
const STEP_LABELS = ['Business Details', 'Contact & Location', 'Documents', 'Review'];
const SERVICES = ['Electrical', 'Plumbing', 'Carpentry', 'Painting', 'Cleaning', 'Security', 'Landscaping', 'General'];

export default function VendorOnboarding() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [bizName, setBizName] = useState('');
  const [bizType, setBizType] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const toggleService = (s: string) =>
    setServices(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const next = () => step < TOTAL_STEPS ? setStep(s => s + 1) : router.push('/vendor/onboarding/verify' as never);
  const back = () => step > 1 ? setStep(s => s - 1) : router.back();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={back}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Vendor Registration</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${(step / TOTAL_STEPS) * 100}%` }]} />
        </View>
        <Text style={styles.stepLabel}>Step {step} of {TOTAL_STEPS}: {STEP_LABELS[step - 1]}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {step === 1 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Business Details</Text>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Business Name</Text>
              <TextInput style={styles.input} value={bizName} onChangeText={setBizName} placeholder="Enter business name" placeholderTextColor={colors.neutral.placeholder} />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Business Type</Text>
              <TextInput style={styles.input} value={bizType} onChangeText={setBizType} placeholder="e.g. Sole Trader, Company" placeholderTextColor={colors.neutral.placeholder} />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Services Offered</Text>
              <View style={styles.servicesWrap}>
                {SERVICES.map(s => (
                  <Pressable key={s} style={[styles.serviceChip, services.includes(s) && styles.serviceChipActive]} onPress={() => toggleService(s)}>
                    <Text style={[styles.serviceChipText, services.includes(s) && styles.serviceChipTextActive]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        )}
        {step === 2 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Contact & Location</Text>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Phone Number</Text>
              <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="+234 8XX XXX XXXX" keyboardType="phone-pad" placeholderTextColor={colors.neutral.placeholder} />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Address / Location</Text>
              <TextInput style={[styles.input, styles.textarea]} value={address} onChangeText={setAddress} placeholder="Enter your business address" multiline numberOfLines={3} textAlignVertical="top" placeholderTextColor={colors.neutral.placeholder} />
            </View>
          </View>
        )}
        {step === 3 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Upload Documents</Text>
            {['Government-issued ID', 'Business Registration'].map((doc, i) => (
              <Pressable key={i} style={styles.uploadBox}>
                <Ionicons name="cloud-upload-outline" size={28} color={colors.neutral.placeholder} />
                <Text style={styles.uploadText}>{doc}</Text>
                <Text style={styles.uploadSub}>Tap to upload (PDF/JPG)</Text>
              </Pressable>
            ))}
          </View>
        )}
        {step === 4 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Review & Submit</Text>
            <View style={styles.reviewCard}>
              {[
                { label: 'Business Name', value: bizName || 'Not provided' },
                { label: 'Business Type', value: bizType || 'Not provided' },
                { label: 'Services', value: services.join(', ') || 'None selected' },
                { label: 'Phone', value: phone || 'Not provided' },
              ].map((row, i) => (
                <View key={i} style={[styles.reviewRow, i < 3 && styles.listBorder]}>
                  <Text style={styles.listLabel}>{row.label}</Text>
                  <Text style={styles.listValue}>{row.value}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.btnRow}>
          {step > 1 && (
            <Pressable style={styles.backActionBtn} onPress={back}>
              <Text style={styles.backActionText}>Back</Text>
            </Pressable>
          )}
          <Pressable style={styles.primaryBtn} onPress={next}>
            <Text style={styles.primaryBtnText}>{step < TOTAL_STEPS ? 'Next' : 'Submit Application'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  progressWrap: { backgroundColor: colors.neutral.surface, padding: 16, gap: 6 },
  progressTrack: { height: 6, backgroundColor: colors.neutral.border, borderRadius: 3 },
  progressFill: { height: 6, backgroundColor: colors.primary.DEFAULT, borderRadius: 3 },
  stepLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600' },
  content: { padding: 20, gap: 16 },
  stepContent: { gap: 16 },
  stepTitle: { fontSize: 18, fontWeight: '700', color: colors.neutral.text },
  fieldGroup: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  textarea: { height: 90, paddingTop: 14 },
  servicesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  serviceChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.neutral.surface, borderWidth: 1.5, borderColor: colors.neutral.border },
  serviceChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  serviceChipText: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600' },
  serviceChipTextActive: { color: '#fff' },
  uploadBox: { backgroundColor: colors.neutral.surface, borderRadius: 14, height: 100, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 2, borderColor: colors.neutral.border, borderStyle: 'dashed' },
  uploadText: { fontSize: 13, fontWeight: '700', color: colors.neutral.text },
  uploadSub: { fontSize: 11, color: colors.neutral.placeholder },
  reviewCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, overflow: 'hidden' },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listLabel: { fontSize: 13, color: colors.neutral.textMuted },
  listValue: { fontSize: 13, fontWeight: '600', color: colors.neutral.text, maxWidth: '60%', textAlign: 'right' },
  btnRow: { flexDirection: 'row', gap: 12 },
  backActionBtn: { flex: 1, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutral.surface, borderWidth: 1, borderColor: colors.neutral.border },
  backActionText: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  primaryBtn: { flex: 2, backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
