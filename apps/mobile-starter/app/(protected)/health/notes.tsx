// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { submitSOAPNote } from '@/api/telemedicine.api';

const C = {
  primary: '#059669',
  primaryDark: '#065f46',
  primaryContainer: '#d1fae5',
  secondary: '#0EA5E9',
  secondaryContainer: '#e0f2fe',
  tertiary: '#F59E0B',
  tertiaryContainer: '#fef3c7',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F5F9',
  text: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
};

const SOAP_FIELDS = [
  { key: 'subjective', label: 'S — Subjective', description: 'Patient\'s chief complaint and history', color: C.primary, bg: C.primaryContainer, icon: 'person-outline', placeholder: 'Describe symptoms in patient\'s own words, onset, duration, severity…' },
  { key: 'objective', label: 'O — Objective', description: 'Physical findings and vitals', color: C.secondary, bg: C.secondaryContainer, icon: 'thermometer-outline', placeholder: 'BP, HR, RR, Temp, SpO₂, physical examination findings…' },
  { key: 'assessment', label: 'A — Assessment', description: 'Diagnosis or differential diagnoses', color: '#8B5CF6', bg: '#ede9fe', icon: 'analytics-outline', placeholder: 'Primary diagnosis, differential diagnosis, ICD-10 codes…' },
  { key: 'plan', label: 'P — Plan', description: 'Treatment and follow-up plan', color: C.tertiary, bg: C.tertiaryContainer, icon: 'list-outline', placeholder: 'Medications prescribed, investigations ordered, referrals, follow-up date…' },
];

export default function ConsultationNotes() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();

  const [soap, setSoap] = useState({ subjective: '', objective: '', assessment: '', plan: '' });
  const [prescriptions, setPrescriptions] = useState([{ drug: '', dosage: '', duration: '' }]);
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: () =>
      submitSOAPNote({
        appointment_id: appointmentId ?? 'appt-001',
        ...soap,
        prescriptions: prescriptions.filter((p) => p.drug.trim()),
      }),
    onSuccess: () => setSubmitted(true),
  });

  const addPrescription = () => {
    setPrescriptions((prev) => [...prev, { drug: '', dosage: '', duration: '' }]);
  };

  const updatePrescription = (index: number, field: string, value: string) => {
    setPrescriptions((prev) => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const removePrescription = (index: number) => {
    setPrescriptions((prev) => prev.filter((_, i) => i !== index));
  };

  if (submitted) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.successContainer}>
          <View style={s.successIcon}>
            <Ionicons name="checkmark-circle" size={72} color={C.primary} />
          </View>
          <Text style={s.successTitle}>Notes Submitted</Text>
          <Text style={s.successSub}>SOAP consultation notes have been saved to the patient's medical record successfully.</Text>
          <Pressable style={s.successBtn} onPress={() => router.push('/health/dashboard' as any)}>
            <Text style={s.successBtnText}>Back to Dashboard</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.headerTitle}>Consultation Notes</Text>
            <Text style={s.headerSub}>SOAP Format</Text>
          </View>
          <Pressable style={s.draftBtn} onPress={() => {}}>
            <Text style={s.draftBtnText}>Save Draft</Text>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
          {/* Patient info banner */}
          <View style={s.patientBanner}>
            <View style={s.patientAvatar}>
              <Ionicons name="person" size={20} color={C.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.patientName}>Chidimma Nwosu</Text>
              <Text style={s.patientMeta}>Female · 32 yrs · Chronic migraine follow-up · 09:30 AM</Text>
            </View>
            <View style={s.apptTypeBadge}>
              <Ionicons name="videocam-outline" size={12} color={C.secondary} />
              <Text style={s.apptTypeText}>Video</Text>
            </View>
          </View>

          {/* SOAP fields */}
          {SOAP_FIELDS.map((field) => (
            <View key={field.key} style={s.soapSection}>
              <View style={s.soapHeader}>
                <View style={[s.soapIconBox, { backgroundColor: field.bg }]}>
                  <Ionicons name={field.icon as any} size={18} color={field.color} />
                </View>
                <View>
                  <Text style={[s.soapLabel, { color: field.color }]}>{field.label}</Text>
                  <Text style={s.soapDesc}>{field.description}</Text>
                </View>
              </View>
              <TextInput
                style={s.soapInput}
                placeholder={field.placeholder}
                placeholderTextColor={C.textMuted}
                value={soap[field.key]}
                onChangeText={(v) => setSoap((prev) => ({ ...prev, [field.key]: v }))}
                multiline
                textAlignVertical="top"
              />
            </View>
          ))}

          {/* Prescription builder */}
          <View style={s.prescriptionSection}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Prescriptions</Text>
              <Pressable style={s.addRxBtn} onPress={addPrescription}>
                <Ionicons name="add-circle" size={18} color={C.primary} />
                <Text style={s.addRxText}>Add Drug</Text>
              </Pressable>
            </View>

            {prescriptions.map((rx, i) => (
              <View key={i} style={s.rxRow}>
                <View style={s.rxNumber}>
                  <Text style={s.rxNumberText}>{i + 1}</Text>
                </View>
                <View style={s.rxFields}>
                  <TextInput
                    style={s.rxInput}
                    placeholder="Drug name"
                    placeholderTextColor={C.textMuted}
                    value={rx.drug}
                    onChangeText={(v) => updatePrescription(i, 'drug', v)}
                  />
                  <View style={s.rxRow2}>
                    <TextInput
                      style={[s.rxInput, { flex: 1, marginRight: 8 }]}
                      placeholder="Dosage"
                      placeholderTextColor={C.textMuted}
                      value={rx.dosage}
                      onChangeText={(v) => updatePrescription(i, 'dosage', v)}
                    />
                    <TextInput
                      style={[s.rxInput, { flex: 1 }]}
                      placeholder="Duration"
                      placeholderTextColor={C.textMuted}
                      value={rx.duration}
                      onChangeText={(v) => updatePrescription(i, 'duration', v)}
                    />
                  </View>
                </View>
                {prescriptions.length > 1 && (
                  <Pressable onPress={() => removePrescription(i)} style={s.rxRemove}>
                    <Ionicons name="close-circle" size={20} color="#ef4444" />
                  </Pressable>
                )}
              </View>
            ))}
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Sticky submit */}
        <View style={s.stickyFooter}>
          <Pressable style={s.draftFooterBtn} onPress={() => {}}>
            <Ionicons name="save-outline" size={18} color={C.primary} />
            <Text style={s.draftFooterText}>Save Draft</Text>
          </Pressable>
          <Pressable
            style={[s.submitBtn, submitMutation.isPending && { opacity: 0.6 }]}
            onPress={() => submitMutation.mutate()}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                <Text style={s.submitBtnText}>Submit Notes</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  headerSub: { fontSize: 12, color: C.textMuted, marginTop: 1 },
  draftBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: C.primaryContainer },
  draftBtnText: { fontSize: 13, color: C.primary, fontWeight: '700' },
  patientBanner: { flexDirection: 'row', alignItems: 'center', margin: 16, backgroundColor: C.surface, borderRadius: 14, padding: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  patientAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  patientName: { fontSize: 15, fontWeight: '700', color: C.text },
  patientMeta: { fontSize: 11, color: C.textMuted, marginTop: 2, lineHeight: 16 },
  apptTypeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.secondaryContainer, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 100 },
  apptTypeText: { fontSize: 11, color: C.secondary, fontWeight: '700' },
  soapSection: { marginHorizontal: 16, marginBottom: 16 },
  soapHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  soapIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  soapLabel: { fontSize: 14, fontWeight: '700' },
  soapDesc: { fontSize: 11, color: C.textMuted, marginTop: 1 },
  soapInput: { backgroundColor: C.surface, borderRadius: 12, padding: 14, fontSize: 14, color: C.text, minHeight: 100, borderWidth: 1, borderColor: C.border, lineHeight: 22 },
  prescriptionSection: { marginHorizontal: 16, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  addRxBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addRxText: { fontSize: 13, color: C.primary, fontWeight: '700' },
  rxRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 10 },
  rxNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  rxNumberText: { fontSize: 13, fontWeight: '700', color: C.primary },
  rxFields: { flex: 1, gap: 8 },
  rxInput: { backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.text, borderWidth: 1, borderColor: C.border },
  rxRow2: { flexDirection: 'row' },
  rxRemove: { paddingTop: 8 },
  stickyFooter: { flexDirection: 'row', gap: 10, padding: 16, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  draftFooterBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12, backgroundColor: C.primaryContainer, borderWidth: 1, borderColor: C.primary },
  draftFooterText: { color: C.primary, fontWeight: '700', fontSize: 15 },
  submitBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12, backgroundColor: C.primary },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIcon: { marginBottom: 20 },
  successTitle: { fontSize: 26, fontWeight: '800', color: C.text, marginBottom: 12 },
  successSub: { fontSize: 15, color: C.textMuted, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  successBtn: { backgroundColor: C.primary, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 14 },
  successBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
