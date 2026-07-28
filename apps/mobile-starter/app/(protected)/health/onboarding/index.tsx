// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { registerDoctor } from '@/api/telemedicine.api';

const C = {
  primary: '#059669',
  primaryDark: '#065f46',
  primaryContainer: '#d1fae5',
  secondary: '#0EA5E9',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F5F9',
  text: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
  error: '#EF4444',
};

const SPECIALTIES = [
  'General Practice', 'Cardiology', 'Pediatrics', 'Dermatology',
  'Mental Health', "Women's Health", 'Orthopedic', 'Neurology',
  'Eye Care', 'Nutrition', 'Dentistry', 'Oncology',
];

const STEPS = ['Personal Info', 'Credentials', 'Specialty'];

export default function DoctorSignup() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    specialty: '',
    years_experience: '',
    mdcn_number: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const registerMutation = useMutation({
    mutationFn: () =>
      registerDoctor({
        ...form,
        years_experience: parseInt(form.years_experience, 10) || 0,
      }),
    onSuccess: () => router.push('/health/onboarding/verify' as any),
  });

  const update = (key: string, val: string) => {
    setForm((prev) => ({ ...prev, [key]: val }));
    if (errors[key]) setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  };

  const validateStep = () => {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!form.full_name) e.full_name = 'Full name is required';
      if (!form.email || !form.email.includes('@')) e.email = 'Valid email is required';
      if (!form.phone || form.phone.length < 10) e.phone = 'Valid phone number is required';
    } else if (step === 1) {
      if (!form.mdcn_number) e.mdcn_number = 'MDCN number is required';
      if (!form.years_experience || isNaN(Number(form.years_experience))) e.years_experience = 'Enter years of experience';
    } else if (step === 2) {
      if (!form.specialty) e.specialty = 'Select a specialty';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (step < 2) setStep((s) => s + 1);
    else registerMutation.mutate();
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={s.header}>
          {step > 0 ? (
            <Pressable onPress={() => setStep((s) => s - 1)} style={s.backBtn}>
              <Ionicons name="arrow-back" size={22} color={C.text} />
            </Pressable>
          ) : (
            <Pressable onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="close" size={22} color={C.text} />
            </Pressable>
          )}
          <Text style={s.headerTitle}>Doctor Registration</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Progress */}
        <View style={s.progressContainer}>
          {STEPS.map((label, i) => (
            <View key={label} style={s.stepItem}>
              <View style={[s.stepDot, i <= step && s.stepDotActive, i < step && s.stepDotDone]}>
                {i < step ? (
                  <Ionicons name="checkmark" size={14} color="#fff" />
                ) : (
                  <Text style={[s.stepNum, i <= step && { color: '#fff' }]}>{i + 1}</Text>
                )}
              </View>
              <Text style={[s.stepLabel, i === step && { color: C.primary, fontWeight: '700' }]}>{label}</Text>
              {i < STEPS.length - 1 && <View style={[s.stepLine, i < step && s.stepLineDone]} />}
            </View>
          ))}
        </View>

        <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
          {step === 0 && (
            <View style={s.formStep}>
              <Text style={s.stepTitle}>Personal Information</Text>
              <Text style={s.stepSub}>Let's start with your basic details</Text>

              <Field label="Full Name" error={errors.full_name}>
                <TextInput style={s.input} placeholder="Dr. John Adebayo" placeholderTextColor={C.textMuted} value={form.full_name} onChangeText={(v) => update('full_name', v)} />
              </Field>
              <Field label="Email Address" error={errors.email}>
                <TextInput style={s.input} placeholder="doctor@hospital.com" placeholderTextColor={C.textMuted} value={form.email} onChangeText={(v) => update('email', v)} keyboardType="email-address" autoCapitalize="none" />
              </Field>
              <Field label="Phone Number" error={errors.phone}>
                <TextInput style={s.input} placeholder="+234 800 000 0000" placeholderTextColor={C.textMuted} value={form.phone} onChangeText={(v) => update('phone', v)} keyboardType="phone-pad" />
              </Field>
            </View>
          )}

          {step === 1 && (
            <View style={s.formStep}>
              <Text style={s.stepTitle}>Medical Credentials</Text>
              <Text style={s.stepSub}>Your MDCN registration and experience</Text>

              <Field label="MDCN Registration Number" error={errors.mdcn_number}>
                <TextInput style={s.input} placeholder="MDCN/2012/0000000" placeholderTextColor={C.textMuted} value={form.mdcn_number} onChangeText={(v) => update('mdcn_number', v)} autoCapitalize="characters" />
              </Field>
              <Field label="Years of Experience" error={errors.years_experience}>
                <TextInput style={s.input} placeholder="e.g. 8" placeholderTextColor={C.textMuted} value={form.years_experience} onChangeText={(v) => update('years_experience', v)} keyboardType="number-pad" />
              </Field>

              <View style={s.infoBox}>
                <Ionicons name="information-circle-outline" size={18} color={C.secondary} />
                <Text style={s.infoText}>You will be asked to upload supporting documents in the next step for verification.</Text>
              </View>
            </View>
          )}

          {step === 2 && (
            <View style={s.formStep}>
              <Text style={s.stepTitle}>Select Your Specialty</Text>
              <Text style={s.stepSub}>Choose your primary area of practice</Text>
              {errors.specialty && <Text style={s.errorText}>{errors.specialty}</Text>}

              <View style={s.specialtiesGrid}>
                {SPECIALTIES.map((spec) => (
                  <Pressable
                    key={spec}
                    style={[s.specialtyChip, form.specialty === spec && s.specialtyChipActive]}
                    onPress={() => update('specialty', spec)}
                  >
                    <Ionicons
                      name={form.specialty === spec ? 'checkmark-circle' : 'radio-button-off'}
                      size={16}
                      color={form.specialty === spec ? '#fff' : C.textMuted}
                    />
                    <Text style={[s.specialtyChipText, form.specialty === spec && { color: '#fff' }]}>{spec}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Sticky CTA */}
        <View style={s.stickyFooter}>
          <Pressable
            style={[s.nextBtn, registerMutation.isPending && { opacity: 0.6 }]}
            onPress={handleNext}
            disabled={registerMutation.isPending}
          >
            {registerMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={s.nextBtnText}>{step < 2 ? 'Continue' : 'Submit Registration'}</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
            )}
          </Pressable>
          <Text style={s.footerNote}>Step {step + 1} of {STEPS.length}</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={s.fieldWrapper}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
      {error && <Text style={s.errorText}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  progressContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, paddingHorizontal: 20, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, gap: 0 },
  stepItem: { flexDirection: 'row', alignItems: 'center' },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.surfaceVariant, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: C.primary, borderColor: C.primary },
  stepDotDone: { backgroundColor: C.primaryDark, borderColor: C.primaryDark },
  stepNum: { fontSize: 12, fontWeight: '700', color: C.textMuted },
  stepLabel: { fontSize: 11, color: C.textMuted, marginLeft: 6, marginRight: 6 },
  stepLine: { width: 24, height: 2, backgroundColor: C.border, marginHorizontal: 2 },
  stepLineDone: { backgroundColor: C.primary },
  formStep: { padding: 20 },
  stepTitle: { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 6 },
  stepSub: { fontSize: 14, color: C.textMuted, marginBottom: 24 },
  fieldWrapper: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 6 },
  input: { backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, color: C.text, borderWidth: 1, borderColor: C.border },
  errorText: { fontSize: 12, color: C.error, marginTop: 4 },
  infoBox: { flexDirection: 'row', gap: 10, backgroundColor: C.secondaryContainer || '#e0f2fe', borderRadius: 12, padding: 14, marginTop: 8, alignItems: 'flex-start' },
  infoText: { flex: 1, fontSize: 13, color: '#0F172A', lineHeight: 20 },
  specialtiesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  specialtyChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 100, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  specialtyChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  specialtyChipText: { fontSize: 13, color: C.textMuted, fontWeight: '500' },
  stickyFooter: { padding: 16, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, gap: 8 },
  nextBtn: { backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, gap: 8 },
  nextBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  footerNote: { textAlign: 'center', fontSize: 12, color: C.textMuted },
});
