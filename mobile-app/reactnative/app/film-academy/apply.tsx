// ── Film Academy — application form (native) ─────────────────────────────────
// Posts to /api/academy/apply, the same endpoint the web form uses. Required by
// the server: full_name, email, phone, batch_id, at least one area of interest,
// and motivation. Those are validated here too so a user is not sent a 400 for
// something the form could have told them immediately.
//
// IDENTITY IS NOT RE-ASKED. Name, email and phone come from the signed-in
// account (the overview payload's `applicant`, with the auth store as an
// immediate fallback) and are shown read-only. Only a field the account genuinely
// lacks gets an input — and what the user types there is saved back to the
// profile by the server, so the next module does not ask for it either. The
// email is never editable: it is the account's address, and the server uses the
// session's own value regardless of what is posted.

import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { getOverview, applyToBatch } from '@/features/filmAcademy/api';
import { useAuthStore } from '@/store/authStore';
import { normalizeAccountName } from '@/features/account/name';
import AccountDetailsCard from '@/features/account/AccountDetailsCard';
import { usePaystackGateway, PAYSTACK_PUBLIC_KEY } from '@/features/payments';
import { FILM_ACADEMY_KEY } from './index';

export default function FilmAcademyApplyScreen() {
  const { batchId } = useLocalSearchParams<{ batchId?: string }>();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: FILM_ACADEMY_KEY, queryFn: getOverview });
  const batch = data?.batches.find((b) => b.id === batchId);

  // When the programme charges an application fee, the server requires a
  // verified Paystack reference that this form cannot yet produce — the submit
  // would be rejected. Say so BEFORE the user fills anything in, rather than
  // failing them at the end. Staging currently has registration_type 'paid'
  // with a NGN 5,000 fee, so this is the live path, not a hypothetical one.
  const feeRequired =
    String(data?.settings?.registration_type ?? '').toLowerCase() === 'paid' &&
    Number(data?.settings?.application_fee ?? 0) > 0;
  const baseFee = Number(data?.settings?.application_fee ?? 0);
  // Only the areas this batch offers. An empty or missing entry means the batch
  // is unrestricted, so it falls back to the full active list rather than
  // showing nothing — which is what batches created before this feature do.
  const offeredSlugs = (batchId && data?.batchAreas?.[batchId]) || [];
  const interestAreas = offeredSlugs.length > 0
    ? (data?.interestAreas ?? []).filter((a) => offeredSlugs.includes(a.slug))
    : (data?.interestAreas ?? []);

  const gateway = usePaystackGateway();
  // Without a publishable key the gateway cannot open at all, so say that
  // rather than letting the user tap Pay into a dead sheet.
  const payReady = Boolean(PAYSTACK_PUBLIC_KEY);

  // What the platform already knows. The server payload wins (it reads the
  // canonical user_profiles row); the auth store fills in before that lands so
  // the card is never briefly blank on a warm cache.
  const account = useAuthStore((s) => s.user);
  const accountName = normalizeAccountName(account?.fullName, account?.email);
  const known = {
    fullName: (data?.applicant?.full_name || accountName || '').trim(),
    email:    (data?.applicant?.email     || account?.email  || '').trim(),
    phone:    (data?.applicant?.phone     || account?.phone  || '').trim(),
  };

  // Only ever hold what the ACCOUNT could not supply. A field the account has is
  // not editable here — changing it belongs in the profile, not in one form.
  const [fullName, setFullName]     = React.useState('');
  const [phone, setPhone]           = React.useState('');
  const [areas, setAreas]           = React.useState<string[]>([]);
  const [motivation, setMotivation] = React.useState('');
  const [experience, setExperience] = React.useState('');
  const [pref, setPref]             = React.useState<'one_off' | 'installment'>('installment');
  const [busy, setBusy]             = React.useState(false);
  const [error, setError]           = React.useState<string | null>(null);

  // Declared AFTER `areas`: this reads it, and a const is in its temporal dead
  // zone until its declaration runs — computing the total above the useState
  // threw "Cannot access 'areas' before initialization" on every render.
  // The SERVER recomputes this total from the same admin-managed rows when the
  // application is submitted, so it is a display convenience and cannot be used
  // to pay less.
  // TUITION for the chosen areas — payable on ACCEPTANCE and refundable. It is
  // shown so the applicant knows the commitment, but it is NOT collected here:
  // charging it at submit would take hundreds of thousands of naira, before
  // anyone had read the application, under a fee the settings mark
  // non-refundable.
  const tuitionTotal = interestAreas
    .filter((a) => areas.includes(a.slug))
    .reduce((sum, a) => sum + Number(a.fee_ngn ?? 0), 0);

  // The only amount charged at submit. Non-refundable.
  const applicationFee = baseFee;

  // The cap is served by the API, not hardcoded here: it is a commercial rule and
  // the server is what enforces it. This only stops the user reaching a rejection.
  const maxAreas = data?.maxInterestAreas ?? 2;
  const atLimit = areas.length >= maxAreas;

  // What actually gets submitted: the account's value, or — only where the
  // account had none — what the user typed into the one input we still show.
  const applicantName  = known.fullName || fullName.trim();
  const applicantEmail = known.email;
  const applicantPhone = known.phone || phone.trim();

  const toggleArea = (a: string) =>
    setAreas((prev) => {
      if (prev.includes(a)) return prev.filter((x) => x !== a);
      // Silently ignoring the tap would look like a broken button, so the chip is
      // disabled and labelled instead — see `atLimit` below.
      if (prev.length >= maxAreas) return prev;
      return [...prev, a];
    });

  /**
   * Posts the application. `reference` is the paid application-fee reference,
   * supplied only when the programme charges one.
   */
  const submitApplication = async (reference?: string) => {
    setBusy(true);
    try {
      await applyToBatch({
        batch_id: batchId!,
        // Sent for older servers that still require them. A current server
        // ignores the email and re-derives all three from the session.
        full_name: applicantName,
        email: applicantEmail,
        phone: applicantPhone,
        areas_of_interest: areas,
        motivation: motivation.trim(),
        experience: experience.trim() || undefined,
        payment_preference: pref,
        application_fee_reference: reference,
      });
      await qc.invalidateQueries({ queryKey: FILM_ACADEMY_KEY });
      Alert.alert('Application submitted', 'We will be in touch about next steps.');
      goBack('/film-academy');
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Could not submit your application. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async () => {
    setError(null);
    // Mirror the server's required fields rather than discovering them via a 400.
    if (!batchId)            return setError('No cohort selected.');
    // The email is the account's own; if there is none, the session is not one
    // that can apply — say so rather than showing an input we would ignore.
    if (!applicantEmail)     return setError('Please sign in to apply.');
    if (!applicantName)      return setError('Enter your full name.');
    if (!applicantPhone)     return setError('Enter your phone number.');
    if (areas.length === 0)  return setError('Choose at least one area of interest.');
    if (areas.length > maxAreas) {
      return setError(`Choose at most ${maxAreas} areas of interest for this batch.`);
    }
    if (!motivation.trim())  return setError('Tell us why you want to join.');

    // No fee due — submit straight away.
    if (!feeRequired) return submitApplication();

    if (!payReady) {
      return setError('Card payment is unavailable right now. Please try again later.');
    }

    // Fee due: collect it FIRST, then submit with the reference. The server
    // re-verifies the reference against Paystack, so nothing here is trusted.
    // application_fee is in NAIRA (the server compares payment.amountKobo / 100
    // against it), hence the x100 to reach kobo.
    setBusy(true);
    gateway.open({
      email: applicantEmail,
      amountKobo: Math.round(applicationFee * 100),
      domain: 'academy_application',
      metadataFields: [
        { display_name: 'Purpose',  variable_name: 'purpose',  value: 'Film Academy application fee' },
        { display_name: 'Cohort',   variable_name: 'batch_id', value: String(batchId) },
      ],
      onSuccess: (reference) => { void submitApplication(reference); },
      onCancel: () => { setBusy(false); setError('Payment cancelled — your application was not submitted.'); },
      onError: (m) => { setBusy(false); setError(m || 'Payment failed. Please try again.'); },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/film-academy')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Apply</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {feeRequired && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>
              ₦{applicationFee.toLocaleString('en-NG')} application fee
            </Text>
            <Text style={styles.noticeText}>
              {payReady
                ? 'Payable by card when you submit. Your application is only sent once the payment succeeds.'
                : 'Card payment is unavailable right now, so this application cannot be submitted yet.'}
            </Text>
          </View>
        )}

        {!!batch && (
          <View style={styles.batchBox}>
            <Text style={styles.batchLabel}>Applying to</Text>
            <Text style={styles.batchName}>{batch.batch_name}</Text>
          </View>
        )}

        {/* Your details, as the account already holds them — read-only. */}
        <AccountDetailsCard
          rows={[
            { label: 'Name',  value: known.fullName },
            { label: 'Email', value: known.email },
            { label: 'Phone', value: known.phone },
          ]}
        />

        {/* Only what the account could NOT supply. Answered once: the server
            saves it to the profile, so no other module asks again. */}
        {!known.fullName && (
          <Field label="Full name" value={fullName} onChange={setFullName} placeholder="Your full name" />
        )}
        {!known.phone && (
          <Field label="Phone number" value={phone} onChange={setPhone} placeholder="0801 234 5678"
                 keyboardType="phone-pad" />
        )}

        <Text style={styles.label}>Areas of interest</Text>
        <Text style={styles.totalNote}>
          Amounts shown are tuition, payable only if you are offered a place.
        </Text>
        <Text style={[styles.noticeText, atLimit && styles.limitReached]}>
          {atLimit
            ? `You have chosen ${maxAreas} of ${maxAreas}. Deselect one to swap it.`
            : `Choose up to ${maxAreas} for this batch — ${areas.length} of ${maxAreas} selected.`}
        </Text>
        {interestAreas.length === 0 ? (
          <Text style={styles.noticeText}>
            No areas are available to choose right now. Please try again later.
          </Text>
        ) : (
          <View style={styles.chips}>
            {interestAreas.map((a) => {
              const on = areas.includes(a.slug);
              const fee = Number(a.fee_ngn ?? 0);
              const blocked = !on && atLimit;
              return (
                <Pressable
                  key={a.slug}
                  onPress={() => toggleArea(a.slug)}
                  disabled={blocked}
                  style={[styles.chip, on && styles.chipOn, blocked && styles.chipBlocked]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: blocked }}
                  accessibilityLabel={fee > 0 ? `${a.label}, tuition ₦${fee.toLocaleString('en-NG')}` : `${a.label}, no tuition`}
                >
                  {on && <Check size={13} color={Colors.primary} />}
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{a.label}</Text>
                  {/* No '+' prefix: this is TUITION if accepted, not an amount
                      added to today's payment. */}
                  <Text style={[styles.chipFee, on && styles.chipTextOn]}>
                    {fee > 0 ? `₦${fee.toLocaleString('en-NG')}` : 'No tuition'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Running total. Tapping a chip adds or removes its line immediately. */}
        <View style={styles.totalBox}>
          <View style={[styles.totalRow, styles.totalRowGrand, { borderTopWidth: 0, marginTop: 0, paddingTop: 0 }]}>
            <Text style={styles.totalGrandLabel}>Pay now</Text>
            <Text style={styles.totalGrandValue}>₦{baseFee.toLocaleString('en-NG')}</Text>
          </View>
          <Text style={styles.totalNote}>
            Application fee. Non-refundable, and charged whether or not you are offered a place.
          </Text>

          {tuitionTotal > 0 && (
            <>
              <View style={[styles.totalRow, styles.totalRowGrand]}>
                <Text style={styles.totalLabel}>Tuition if accepted</Text>
                <Text style={styles.totalValue}>₦{tuitionTotal.toLocaleString('en-NG')}</Text>
              </View>
              {interestAreas
                .filter((a) => areas.includes(a.slug) && Number(a.fee_ngn ?? 0) > 0)
                .map((a) => (
                  <View key={a.slug} style={styles.totalRow}>
                    <Text style={styles.totalSubLabel}>{a.label}</Text>
                    <Text style={styles.totalSubValue}>
                      ₦{Number(a.fee_ngn).toLocaleString('en-NG')}
                    </Text>
                  </View>
                ))}
              <Text style={styles.totalNote}>
                Payable only if you are offered a place, and refundable. Nothing for
                tuition is taken today.
              </Text>
            </>
          )}
        </View>

        <Field label="Why do you want to join?" value={motivation} onChange={setMotivation}
               placeholder="A few sentences" multiline />
        <Field label="Relevant experience (optional)" value={experience} onChange={setExperience}
               placeholder="Any prior work or training" multiline />

        <Text style={styles.label}>How would you like to pay?</Text>
        <View style={styles.chips}>
          {(['installment', 'one_off'] as const).map((p) => (
            <Pressable key={p} onPress={() => setPref(p)} style={[styles.chip, pref === p && styles.chipOn]}>
              <Text style={[styles.chipText, pref === p && styles.chipTextOn]}>
                {p === 'installment' ? 'In instalments' : 'One-off'}
              </Text>
            </Pressable>
          ))}
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.submit, busy && styles.submitBusy]} onPress={onSubmit} disabled={busy}>
          {busy ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.submitText}>
                    {feeRequired
                      ? `Pay ₦${applicationFee.toLocaleString('en-NG')} & submit`
                      : 'Submit application'}
                  </Text>}
        </Pressable>

        {/* Hosts the Paystack checkout WebView on native; renders nothing on web. */}
        <gateway.Sheet />
      </ScrollView>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  multiline?: boolean; keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={[styles.input, props.multiline && styles.inputMulti]}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor={Colors.onSurfaceVariant}
        multiline={props.multiline}
        keyboardType={props.keyboardType ?? 'default'}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  back:        { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll:      { padding: Spacing.containerMargin, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  batchBox:    { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg },
  batchLabel:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  batchName:   { ...Typography.titleMd, color: Colors.onSurface },
  field:       { gap: 6 },
  label:       { ...Typography.labelMd, color: Colors.onSurface },
  input:       { backgroundColor: Colors.surface, borderRadius: Radius.md, paddingHorizontal: Spacing.md,
                 paddingVertical: 12, ...Typography.bodyMd, color: Colors.onSurface },
  inputMulti:  { minHeight: 96, textAlignVertical: 'top' },
  chips:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8,
                 borderRadius: Radius.md, backgroundColor: Colors.surface },
  chipOn:      { backgroundColor: Colors.iconBgPurple },
  chipBlocked: { opacity: 0.35 },
  chipText:    { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextOn:  { color: Colors.primary },
  chipFee:     { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  totalBox:    { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: 6 },
  totalRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalRowGrand: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh,
                   paddingTop: 8, marginTop: 4 },
  totalLabel:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  totalValue:  { ...Typography.bodyMd, color: Colors.onSurface },
  totalGrandLabel: { ...Typography.labelLg, color: Colors.onSurface },
  totalGrandValue: { ...Typography.titleMd, color: Colors.onSurface },
  totalSubLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, paddingLeft: 10 },
  totalSubValue: { ...Typography.caption, color: Colors.onSurfaceVariant },
  totalNote:     { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  error:       { ...Typography.bodyMd, color: Colors.error },
  noticeBox:   { backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.lg, gap: 4 },
  noticeTitle: { ...Typography.labelLg, color: Colors.onSurface },
  noticeText:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  limitReached: { color: Colors.gold },
  submit:      { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 14,
                 alignItems: 'center', marginTop: Spacing.sm },
  submitBusy:  { opacity: 0.7 },
  submitText:  { ...Typography.labelLg, color: '#FFFFFF' },
});
