import React, { useEffect } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { sanitizeMoneyInput } from '@/utils/money';
import SelectField from '@/components/SelectField';
import SectionHeader from '@/components/SectionHeader';
import { useApplyStore, EMPLOYMENT_OPTIONS } from '@/features/realtor/store/applyStore';
import { useListing } from '@/features/realtor/hooks/useRealtor';
import type { EmploymentStatus } from '@/features/realtor/types/realtor.types';
import { useAccountIdentity } from '@/features/account/identity';
import AccountDetailsCard from '@/features/account/AccountDetailsCard';

export default function ApplyScreen() {
  const { listingId, inspectionId } = useLocalSearchParams<{ listingId: string; inspectionId?: string }>();
  const { draft, set, init } = useApplyStore();
  const listing = useListing(String(listingId));
  const account = useAccountIdentity();
  const [error, setError] = React.useState<string>();

  // Seed the draft for this listing on first mount.
  useEffect(() => {
    if (listingId && draft.listingId !== String(listingId)) {
      init(String(listingId), inspectionId ? String(inspectionId) : undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  // The applicant gave these at sign-up — carry them into the draft instead of
  // asking again. Blanks only, and it runs after init() so a reset re-seeds.
  useEffect(() => {
    const patch: Partial<typeof draft> = {};
    if (account.fullName && !draft.fullName) patch.fullName = account.fullName;
    if (account.email && !draft.email) patch.email = account.email;
    if (account.phone && !draft.phone) patch.phone = account.phone;
    if (Object.keys(patch).length > 0) set(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.fullName, account.email, account.phone, draft.listingId]);

  const incomeNaira = draft.monthlyIncome ? String(draft.monthlyIncome / 100) : '';

  const next = () => {
    if (draft.fullName.trim().length < 2) return setError('Please enter your full name.');
    if (!/^\S+@\S+\.\S+$/.test(draft.email)) return setError('Please enter a valid email.');
    if (draft.phone.trim().length < 7) return setError('Please enter a valid phone number.');
    if (draft.monthlyIncome <= 0) return setError('Please enter your monthly income.');
    if (draft.guarantorName.trim().length < 2) return setError('Please add a guarantor.');
    if (!draft.screeningConsent) return setError('Please consent to tenant screening to continue.');
    setError(undefined);
    router.push('/realtor/apply/review');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Apply for property" subtitle={listing.data?.title} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text style={styles.introText}>
            Tell us about yourself. This goes to the landlord for review — accurate details speed up approval.
          </Text>
        </View>

        <SectionHeader title="Personal details" style={styles.sectionFlush} />
        {/* Read-only: these are account facts, changed in the profile, not here. */}
        <AccountDetailsCard
          rows={[
            { label: 'Name',  value: account.fullName },
            { label: 'Email', value: account.email },
            { label: 'Phone', value: account.phone },
          ]}
        />
        {!account.fullName && (
          <TextInputField label="Full name" placeholder="As on your ID" value={draft.fullName} onChangeText={(t) => set({ fullName: t })} />
        )}
        {!account.email && (
          <TextInputField label="Email" placeholder="you@email.com" keyboardType="email-address" autoCapitalize="none" value={draft.email} onChangeText={(t) => set({ email: t })} />
        )}
        {/* Keeps the shared PhoneNumberInput — only reached when the account has
            no phone on file. */}
        {!account.phone && (
          <PhoneNumberInput label="Phone number" value={draft.phone} onChange={({ e164, nsn }) => ((t) => set({ phone: t }))(e164 || nsn)} />
        )}
        <TextInputField label="Number of occupants" placeholder="1" keyboardType="number-pad" value={draft.occupants ? String(draft.occupants) : ''} onChangeText={(t) => set({ occupants: Number(t.replace(/\D/g, '')) || 1 })} />
        <TextInputField label="Preferred move-in date" placeholder="e.g. 1 Aug 2026" value={draft.moveInDate} onChangeText={(t) => set({ moveInDate: t })} />

        <SectionHeader title="Employment & income" style={styles.sectionFlush} />
        <SelectField
          label="Employment status"
          value={EMPLOYMENT_OPTIONS.find((o) => o.value === draft.employmentStatus)?.label}
          options={EMPLOYMENT_OPTIONS.map((o) => o.label)}
          searchable={false}
          onChange={(label) => {
            const v = EMPLOYMENT_OPTIONS.find((o) => o.label === label);
            if (v) set({ employmentStatus: v.value as EmploymentStatus });
          }}
        />
        <TextInputField label="Employer / business name" placeholder="Optional" value={draft.employerName} onChangeText={(t) => set({ employerName: t })} />
        <TextInputField
          label="Monthly income (₦)"
          placeholder="e.g. 800000"
          keyboardType="decimal-pad"
          inputMode="decimal"
          maxLength={13}
          value={incomeNaira}
          onChangeText={(t) => set({ monthlyIncome: (Number(sanitizeMoneyInput(t)) || 0) * 100 })}
        />

        <SectionHeader title="Guarantor" style={styles.sectionFlush} />
        <TextInputField label="Guarantor name" placeholder="Full name" value={draft.guarantorName} onChangeText={(t) => set({ guarantorName: t })} />
        <PhoneNumberInput label="Guarantor phone" value={draft.guarantorPhone} onChange={({ e164, nsn }) => ((t) => set({ guarantorPhone: t }))(e164 || nsn)} />
        <TextInputField label="Relationship" placeholder="e.g. Employer, relative" value={draft.guarantorRelationship} onChangeText={(t) => set({ guarantorRelationship: t })} />

        {/* Screening consent */}
        <Pressable style={styles.consent} onPress={() => set({ screeningConsent: !draft.screeningConsent })} accessibilityRole="checkbox" accessibilityState={{ checked: draft.screeningConsent }}>
          <View style={[styles.checkbox, draft.screeningConsent && styles.checkboxOn]}>
            {draft.screeningConsent ? <ShieldCheck size={14} color={Colors.onPrimary} strokeWidth={2.5} /> : null}
          </View>
          <Text style={styles.consentText}>
            I consent to tenant screening and verification of the details I've provided.
          </Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Review application" onPress={next} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  intro: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  introText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  sectionFlush: { paddingHorizontal: 0, marginTop: Spacing.md },
  consent: {
    flexDirection: 'row',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  checkbox: {
    width: 24, height: 24, borderRadius: Radius.sm,
    borderWidth: 1.5, borderColor: Colors.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 20 },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.md },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceContainerLow,
    backgroundColor: Colors.surfaceContainerLowest,
  },
});
