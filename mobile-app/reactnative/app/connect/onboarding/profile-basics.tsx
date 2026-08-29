import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import OnboardingStep from '@/features/connect/components/OnboardingStep';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import {
  useOnboardingDraft,
  useSaveOnboardingDraft,
  useSubmitDob,
} from '@/features/connect/hooks/useConnect';
import { fillProfileGaps, getProfile } from '@/api/profile.api';
import { buildBasicsPrefill } from '@/features/connect/lib/profilePrefill';
import { mergePrefillSources } from '@/features/connect/lib/prefillSources';
import { fetchExtraPrefillSources } from '@/features/connect/lib/fetchPrefillSources';

// ON-07 — Profile wizard, basics. Name, DOB (date widget), gender, location.
// HARD 18+ AGE GATE (SAFETY INVARIANT §1): DOB is validated; suspected minors are
// flagged and routed to the underage block screen.
//
// PREFILLED from the account: the user gave all four of these when they set up
// their Paymax profile, so the step opens with them filled in rather than blank.
// Everything stays EDITABLE — a Connect display name is a chosen name, not a
// legal one, and someone may well present differently here than on their KYC
// record. Only values the pickers can actually display are used; see
// `features/connect/lib/profilePrefill`. The 18+ gate is unaffected: it is
// decided server-side on submit, whatever the fields were seeded with.
const GENDERS = ['Female', 'Male'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// 36 states + FCT.
const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT - Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

const pad = (n: number) => String(n).padStart(2, '0');
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));
const CURRENT_YEAR = new Date().getFullYear();
// Earliest selectable birth year is 18 years ago (hard 18+ gate); span 100 years.
const YEARS = Array.from({ length: 100 }, (_, i) => String(CURRENT_YEAR - 18 - i));

// Builds a valid yyyy-mm-dd or '' when the parts don't form a real calendar date
// (e.g. 31 February). Guards the rollover that `new Date()` would otherwise allow.
function composeDob(day: string, monthName: string, year: string): string {
  if (!day || !monthName || !year) return '';
  const m = MONTHS.indexOf(monthName) + 1;
  const d = Number(day);
  const y = Number(year);
  if (m < 1 || d < 1 || !y) return '';
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
}

export default function ProfileBasics() {
  const [name, setName] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [gender, setGender] = useState('');
  const [location, setLocation] = useState('');
  const [dobError, setDobError] = useState<string | undefined>();
  const [prefilled, setPrefilled] = useState(false);

  const save = useSaveOnboardingDraft();
  const submitDob = useSubmitDob();

  // The account's own record. Shares the ['profile'] cache with the Profile tab,
  // so arriving from there costs no extra request. A failure is silent by
  // design: prefill is a convenience, and onboarding must still work for someone
  // whose profile row cannot be read.
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: false });

  // `user_profiles` is usually near-empty here — sign-up captures only a name
  // and phone. The gender/DOB/state this step needs were, for many users,
  // already given on a Film Academy application or a contest registration, so
  // those fill the gaps. See `features/connect/lib/prefillSources`.
  const extraQuery = useQuery({
    queryKey: ['connect', 'prefill-sources'],
    queryFn: fetchExtraPrefillSources,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const draftQuery = useOnboardingDraft();

  // Seed ONCE, and only after both sources have settled — otherwise the slower
  // of the two would overwrite fields the user had already started editing.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    if (profileQuery.isLoading || draftQuery.isLoading || extraQuery.isLoading) return;
    seeded.current = true;

    // Profile first, then everything else fills its gaps.
    const source = mergePrefillSources(profileQuery.data, ...(extraQuery.data ?? []));
    const prefill = buildBasicsPrefill(source, draftQuery.data, {
      days: DAYS, months: MONTHS, years: YEARS, genders: GENDERS, states: NIGERIAN_STATES,
    });
    if (prefill.name) setName(prefill.name);
    if (prefill.day) setDay(prefill.day);
    if (prefill.month) setMonth(prefill.month);
    if (prefill.year) setYear(prefill.year);
    if (prefill.gender) setGender(prefill.gender);
    if (prefill.location) setLocation(prefill.location);
    setPrefilled(
      Boolean(prefill.name || prefill.year || prefill.gender || prefill.location),
    );
  }, [
    profileQuery.isLoading, profileQuery.data,
    draftQuery.isLoading, draftQuery.data,
    extraQuery.isLoading, extraQuery.data,
  ]);

  const dob = useMemo(() => composeDob(day, month, year), [day, month, year]);
  const dobTouched = !!(day && month && year);
  const canContinue =
    name.trim().length >= 2 && !!dob && gender.length > 0 && location.length > 0;

  const onNext = () => {
    if (!dob) {
      setDobError('Please choose a valid date of birth.');
      return;
    }
    setDobError(undefined);
    submitDob.mutate(dob, {
      onSuccess: (res) => {
        if (res.underage) {
          router.replace('/connect/onboarding/underage');
          return;
        }
        save.mutate(
          { displayName: name.trim(), dob, gender, location },
          {
            onSuccess: () => {
              // The user has just confirmed these, so fill any BLANK profile
              // columns with them and no other form has to ask again. Not the
              // display name: that is a Connect handle, not their real name.
              // Fire-and-forget — a failed backfill must never hold up
              // onboarding, and `fillProfileGaps` never rejects.
              void fillProfileGaps({ dateOfBirth: dob, gender, state: location });
              router.push('/connect/onboarding/photos');
            },
          },
        );
      },
      onError: () => setDobError('Could not verify your age. Please try again.'),
    });
  };

  return (
    <OnboardingStep
      step={2}
      totalSteps={5}
      title="The basics"
      subtitle="This helps people find the real you. You must be 18 or older."
      primaryLabel="Continue"
      onPrimary={onNext}
      primaryDisabled={!canContinue}
      primaryLoading={submitDob.isPending || save.isPending}
      footerNote="Your date of birth is used only to confirm you're 18+ and is never shown on your profile."
    >
      {prefilled ? (
        <Text style={styles.prefillNote}>
          We&rsquo;ve filled these in from your account — change anything you&rsquo;d rather
          show on Connect.
        </Text>
      ) : null}

      <TextInputField
        label="Display name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Amara"
        autoCapitalize="words"
      />

      <View>
        <Text style={styles.label}>Date of birth</Text>
        <View style={styles.dobRow}>
          <View style={styles.dobCol}>
            <SelectField
              placeholder="Day"
              value={day}
              options={DAYS}
              onChange={setDay}
              searchable={false}
            />
          </View>
          <View style={styles.dobCol}>
            <SelectField
              placeholder="Month"
              value={month}
              options={MONTHS}
              onChange={setMonth}
              searchable={false}
            />
          </View>
          <View style={styles.dobCol}>
            <SelectField
              placeholder="Year"
              value={year}
              options={YEARS}
              onChange={setYear}
              searchable
            />
          </View>
        </View>
        {dobTouched && !dob ? (
          <Text style={styles.error}>That date isn’t valid — please check the day.</Text>
        ) : dobError ? (
          <Text style={styles.error}>{dobError}</Text>
        ) : null}
      </View>

      <SelectField
        label="Gender"
        placeholder="Select gender"
        value={gender}
        options={GENDERS}
        onChange={setGender}
        searchable={false}
      />

      <SelectField
        label="Location"
        placeholder="Select your state"
        value={location}
        options={NIGERIAN_STATES}
        onChange={setLocation}
        searchable
      />
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  prefillNote: { ...Typography.caption, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  dobRow: { flexDirection: 'row', gap: Spacing.sm },
  dobCol: { flex: 1 },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
});
