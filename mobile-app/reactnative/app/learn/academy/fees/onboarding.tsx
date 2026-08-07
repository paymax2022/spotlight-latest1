import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, GraduationCap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { useDirectory, useLinkChild } from '@/features/academy/fees/hooks';
import { alertAsync } from '@/lib/confirm';

/** PA-01 — Onboarding: link a child to a school by admission number (guardian link). */
export default function FeesOnboarding() {
  const directory = useDirectory();
  const link = useLinkChild();
  const [schoolName, setSchoolName] = useState('');
  const [admissionNumber, setAdmissionNumber] = useState('');
  const [firstName, setFirstName] = useState('');

  const schools = directory.data ?? [];
  const schoolOptions = schools.map((s) => s.name);
  const selected = schools.find((s) => s.name === schoolName);

  const canSubmit = !!selected && admissionNumber.trim().length >= 4 && firstName.trim().length >= 2;

  const onSubmit = () => {
    if (!selected || !canSubmit) return;
    link.mutate(
      { schoolId: selected.id, admissionNumber: admissionNumber.trim(), firstName: firstName.trim() },
      {
        onSuccess: (child) => {
          alertAsync({ title: 'Child linked', message: `${child.firstName} at ${child.schoolName} is now linked to your account.`, buttonLabel: 'View family' }).then(() => router.replace('/learn/academy/fees'));
        },
        onError: (e) => alertAsync({ title: 'Could not link', message: (e as Error).message }),
      },
    );
  };

  if (directory.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Link a child" />
        <StateView kind="loading" message="Loading schools…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Link a child" subtitle="PA-01 · Guardian link" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroIcon}><GraduationCap size={26} color={Colors.primary} /></View>
          <Text style={styles.heroTitle}>Connect to your child's school</Text>
          <Text style={styles.heroSub}>
            Enter the school and your child's admission number. The school confirms the link, then you can view invoices and pay fees securely.
          </Text>
        </View>

        <View style={styles.form}>
          <SelectField
            label="School"
            placeholder="Select the school"
            value={schoolName}
            options={schoolOptions}
            onChange={setSchoolName}
            searchable
          />
          <TextInputField
            label="Child's first name"
            placeholder="e.g. Adaeze"
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
          />
          <TextInputField
            label="Admission number"
            placeholder="e.g. BSA/2023/041"
            value={admissionNumber}
            onChangeText={setAdmissionNumber}
            autoCapitalize="characters"
          />
        </View>

        {/* Child-safety note (guardian consent recorded, NDPA) */}
        <View style={[styles.consent, shadow1]}>
          <ShieldCheck size={18} color={Colors.teal} />
          <Text style={styles.consentText}>
            Linking records your guardian consent for this minor. You can review or withdraw it at any time. We only share what's needed to manage fees.
          </Text>
        </View>

        <PrimaryButton
          label="Link child"
          onPress={onSubmit}
          loading={link.isPending}
          disabled={!canSubmit}
          style={{ marginTop: Spacing.md }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  heroIcon: { width: 60, height: 60, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  form: { gap: Spacing.sm },
  consent: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'flex-start' },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
});
