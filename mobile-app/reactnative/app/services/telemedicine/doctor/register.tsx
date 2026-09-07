import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, Pressable, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BadgeCheck, ShieldCheck } from 'lucide-react-native';
import { useMutation } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { alertAsync } from '@/lib/confirm';
import { registerDoctor } from '@/api/telemedicine.api';
import { TeleHeader } from '@/features/telemedicine/components';

// These are the ONLY values the database accepts — doctors.specialty carries a
// CHECK constraint listing exactly these six. Offering a free-text field or a
// wider list would let the app submit something the INSERT rejects, surfacing as
// an opaque 500 well after the user finished typing.
const SPECIALTIES = [
  { value: 'general',      label: 'General practice' },
  { value: 'cardiology',   label: 'Cardiology' },
  { value: 'dermatology',  label: 'Dermatology' },
  { value: 'paediatrics',  label: 'Paediatrics' },
  { value: 'veterinary',   label: 'Veterinary' },
  { value: 'pharmacy',     label: 'Pharmacy' },
] as const;

export default function DoctorOnboardingScreen() {
  const [fullName, setFullName]   = useState('');
  const [email, setEmail]         = useState('');
  const [phone, setPhone]         = useState('');
  const [specialty, setSpecialty] = useState<string>('general');
  const [years, setYears]         = useState('');
  const [mdcn, setMdcn]           = useState('');
  const [touched, setTouched]     = useState(false);

  // Mirrors the server's `binding:"required"` rules so the user is told what is
  // missing before a round trip, not by a 400 naming a snake_case field.
  const errors = {
    fullName: fullName.trim().length < 2  ? 'Enter your full name'          : '',
    email:    !/^\S+@\S+\.\S+$/.test(email.trim()) ? 'Enter a valid email'  : '',
    phone:    phone.trim().length < 7     ? 'Enter your phone number'       : '',
    mdcn:     mdcn.trim().length < 3      ? 'Enter your MDCN number'        : '',
    years:    years !== '' && (Number.isNaN(Number(years)) || Number(years) < 0)
      ? 'Years must be a positive number' : '',
  };
  const valid = !Object.values(errors).some(Boolean);

  const { mutate, isPending } = useMutation({
    mutationFn: () => registerDoctor({
      fullName, email, phone, specialty,
      yearsExperience: years === '' ? 0 : Number(years),
      mdcnNumber: mdcn,
    }),
    onSuccess: async () => {
      await alertAsync({
        title: 'Application received',
        message:
          'Thanks — your details are with our clinical team. Your profile stays hidden '
          + 'until your MDCN registration is verified, so patients will not see or be '
          + 'able to book you yet. We will be in touch by email.',
        buttonLabel: 'Done',
      });
      router.back();
    },
    onError: async (err: unknown) => {
      await alertAsync({
        title: 'Could not submit',
        message: (err as Error)?.message ?? 'Something went wrong. Please try again.',
      });
    },
  });

  const onSubmit = () => {
    setTouched(true);
    if (!valid) return;
    mutate();
  };

  const field = (
    label: string, value: string, onChange: (t: string) => void,
    error: string, placeholder: string, keyboardType?: 'email-address' | 'phone-pad' | 'number-pad',
  ) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, touched && error ? styles.inputError : null]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.outline}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
      />
      {touched && error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Practise on Paymax" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.intro, shadow1]}>
          <View style={styles.introIcon}>
            <ShieldCheck size={22} color={Colors.primary} strokeWidth={2} />
          </View>
          <Text style={styles.introTitle}>Join as a doctor</Text>
          <Text style={styles.introBody}>
            Consult with patients by video, audio or chat. We verify every MDCN registration
            before a profile goes live — your details are not shown to patients until then.
          </Text>
        </View>

        {field('Full name', fullName, setFullName, errors.fullName, 'Dr. Amaka Obi')}
        {field('Email', email, setEmail, errors.email, 'you@example.com', 'email-address')}
        {field('Phone', phone, setPhone, errors.phone, '080 0000 0000', 'phone-pad')}

        <View style={styles.field}>
          <Text style={styles.label}>Specialty</Text>
          <View style={styles.chips}>
            {SPECIALTIES.map((s) => {
              const active = specialty === s.value;
              return (
                <Pressable
                  key={s.value}
                  onPress={() => setSpecialty(s.value)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {field('Years of experience', years, setYears, errors.years, '0', 'number-pad')}
        {field('MDCN registration number', mdcn, setMdcn, errors.mdcn, 'MDCN/R/00000')}

        <Pressable
          style={[styles.submit, (!valid && touched) && styles.submitDisabled]}
          onPress={onSubmit}
          disabled={isPending}
        >
          {isPending
            ? <ActivityIndicator color={Colors.onPrimary} />
            : (
              <>
                <BadgeCheck size={18} color={Colors.onPrimary} strokeWidth={2.2} />
                <Text style={styles.submitText}>Submit application</Text>
              </>
            )}
        </Pressable>

        <Text style={styles.footnote}>
          By submitting you confirm the details are accurate and that you are currently
          licensed to practise.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 120 : 96, gap: Spacing.md },
  intro:       { padding: Spacing.cardPadding, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.xs, marginBottom: Spacing.sm },
  introIcon:   { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  introTitle:  { ...Typography.titleLg, color: Colors.onSurface },
  introBody:   { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  field:       { gap: 6 },
  label:       { ...Typography.labelMd, color: Colors.onSurface },
  input:       { height: 48, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, paddingHorizontal: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface },
  inputError:  { borderColor: Colors.error },
  error:       { ...Typography.caption, color: Colors.error },
  chips:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip:        { paddingHorizontal: Spacing.md, height: 38, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLowest },
  chipActive:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:    { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.onPrimary },
  submit:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, height: 52, borderRadius: Radius.full, backgroundColor: Colors.primary, marginTop: Spacing.sm },
  submitDisabled: { opacity: 0.5 },
  submitText:  { ...Typography.labelLg, color: Colors.onPrimary },
  footnote:    { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
