import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, FileText, ShieldCheck, UserCog, ChevronRight, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard } from '@/features/doctor/components';
import { useSubmitVerification } from '@/features/doctor/hooks';
import { VERIFICATION_DOC_TYPES, SPECIALTY_OPTIONS } from '@/features/doctor/constants';
import type { VerificationDocType } from '@/types/doctor';

export default function DoctorSignupScreen() {
  const [mdcnNumber, setMdcnNumber] = useState('');
  const [specialty, setSpecialty] = useState<string>();
  const [uploaded, setUploaded] = useState<VerificationDocType[]>([]);
  const [error, setError] = useState<string>();
  const submit = useSubmitVerification();

  const toggleDoc = (type: VerificationDocType) => {
    setUploaded((prev) => (prev.includes(type) ? prev.filter((d) => d !== type) : [...prev, type]));
  };

  const requiredDocs = VERIFICATION_DOC_TYPES.filter((d) => d.required).map((d) => d.type);
  const missingRequired = requiredDocs.filter((d) => !uploaded.includes(d));
  const canSubmit = mdcnNumber.trim().length > 0 && missingRequired.length === 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      setError('Enter your MDCN number and upload all required documents.');
      return;
    }
    setError(undefined);
    try {
      await submit.mutateAsync({ mdcnNumber: mdcnNumber.trim(), documents: uploaded });
      router.replace('/(doctor)/signup/pending');
    } catch {
      setError('Submission failed. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Doctor Verification" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <ShieldCheck size={24} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.introTitle}>Get verified to practise</Text>
            <Text style={styles.introSub}>We verify every doctor against the MDCN register before they can accept consultations.</Text>
          </View>

          <Pressable
            onPress={() => router.push('/(doctor)/onboarding')}
            style={styles.onboardLink}
            accessibilityRole="button"
            accessibilityLabel="Start guided provider onboarding"
          >
            <View style={styles.onboardIcon}>
              <Sparkles size={20} color={Colors.onPrimary} strokeWidth={2} />
            </View>
            <View style={styles.profileLinkBody}>
              <Text style={styles.onboardTitle}>New here? Start guided onboarding</Text>
              <Text style={styles.onboardSub}>Intro, provider type, agreements, permissions & profile</Text>
            </View>
            <ChevronRight size={18} color={Colors.onPrimary} strokeWidth={2} />
          </Pressable>

          <Pressable
            onPress={() => router.push('/(doctor)/profile/setup')}
            style={styles.profileLink}
            accessibilityRole="button"
            accessibilityLabel="Create your full doctor profile"
          >
            <View style={styles.profileLinkIcon}>
              <UserCog size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.profileLinkBody}>
              <Text style={styles.profileLinkTitle}>Create your full profile</Text>
              <Text style={styles.profileLinkSub}>Bio, credentials, pricing & payout — step by step</Text>
            </View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>

          <SectionCard title="Registration details" style={styles.card}>
            <TextInputField
              label="MDCN Registration Number"
              placeholder="e.g. MDCN/R/45821"
              value={mdcnNumber}
              onChangeText={setMdcnNumber}
              autoCapitalize="characters"
            />
            <SelectField label="Primary specialty" placeholder="Select specialty" value={specialty} options={SPECIALTY_OPTIONS.map((s) => s.label)} onChange={setSpecialty} />
          </SectionCard>

          <SectionCard title="Required documents" style={styles.card}>
            <Text style={styles.cardHint}>Tap to mark each document as uploaded.</Text>
            {VERIFICATION_DOC_TYPES.map((doc) => {
              const selected = uploaded.includes(doc.type);
              return (
                <Pressable
                  key={doc.type}
                  onPress={() => toggleDoc(doc.type)}
                  style={[styles.docRow, selected && styles.docRowSelected]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={doc.label}
                >
                  <View style={[styles.docIcon, { backgroundColor: selected ? Colors.iconBgPurple : Colors.surfaceContainerLow }]}>
                    <FileText size={18} color={selected ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
                  </View>
                  <View style={styles.docBody}>
                    <Text style={styles.docLabel} numberOfLines={1}>{doc.label}</Text>
                    <Text style={styles.docMeta}>{doc.required ? 'Required' : 'Optional'}</Text>
                  </View>
                  <View style={[styles.checkbox, selected && styles.checkboxOn]}>
                    {selected && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
                  </View>
                </Pressable>
              );
            })}
          </SectionCard>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <PrimaryButton label="Submit for verification" onPress={handleSubmit} loading={submit.isPending} disabled={!canSubmit} style={styles.submitBtn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  flex:          { flex: 1 },
  content:       { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  intro:         { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  introIcon:     { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  introTitle:    { ...Typography.titleLg, color: Colors.onSurface },
  introSub:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:          { marginBottom: Spacing.md },
  onboardLink:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.primary, marginBottom: Spacing.md },
  onboardIcon:   { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  onboardTitle:  { ...Typography.labelLg, color: Colors.onPrimary },
  onboardSub:    { ...Typography.caption, color: Colors.inversePrimary },
  profileLink:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.primaryFixed, marginBottom: Spacing.md },
  profileLinkIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  profileLinkBody: { flex: 1, gap: 2 },
  profileLinkTitle:{ ...Typography.labelLg, color: Colors.onSurface },
  profileLinkSub:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  cardHint:      { ...Typography.caption, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  docRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  docRowSelected:{ borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  docIcon:       { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  docBody:       { flex: 1, gap: 2 },
  docLabel:      { ...Typography.labelLg, color: Colors.onSurface },
  docMeta:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  checkbox:      { width: 24, height: 24, borderRadius: Radius.sm + 2, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  error:         { ...Typography.labelMd, color: Colors.error, marginBottom: Spacing.sm, textAlign: 'center' },
  submitBtn:     { marginTop: Spacing.sm },
});
