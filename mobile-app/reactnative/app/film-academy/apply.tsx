// Posts to /api/academy/apply, the same endpoint the web form uses. Required by
// the server: full_name, email, phone, batch_id, at least one area of interest,
// and motivation. Those are validated here too so a user is not sent a 400 for
// something the form could have told them immediately.
// IDENTITY IS NOT RE-ASKED. Name, email and phone come from the signed-in
// account (the overview payload's `applicant`, with the auth store as an
// immediate fallback) and are shown read-only. Only a field the account genuinely
// lacks gets an input — and what the user types there is saved back to the
// profile by the server, so the next module does not ask for it either. The
// email is never editable: it is the account's address, and the server uses the
// session's own value regardless of what is posted.

import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Check, BedDouble, Trash2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow2 } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import AreaOptionSheet from '@/features/filmAcademy/components/AreaOptionSheet';
import { fromPrice, optionPrice, summarise } from '@/features/filmAcademy/optionPricing';
import {
  canAddArea, hasOptions, reconcilePicks, removePick, toSelections, upsertPick, type AreaPick,
} from '@/features/filmAcademy/picks';
import type { FilmAcademyAreaOption, FilmAcademyInterestArea } from '@/features/filmAcademy/types';
import { getOverview, applyToBatch } from '@/features/filmAcademy/api';
import { useAuthStore } from '@/store/authStore';
import { normalizeAccountName } from '@/features/account/name';
import AccountDetailsCard from '@/features/account/AccountDetailsCard';
import { usePaystackGateway, PAYSTACK_PUBLIC_KEY } from '@/features/payments';
import { HomeMenuButton } from '@/components/HomeMenu';
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
  const insets = useSafeAreaInsets();
  // Without a publishable key the gateway cannot open at all, so say that
  // rather than letting the user tap Pay into a dead sheet.
  const payReady = Boolean(PAYSTACK_PUBLIC_KEY);

  // What the platform already knows. The server payload wins (it reads the
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
  // One pick per area, keyed by area slug. Held raw; `picks` below is the
  // version re-bound to the batch's CURRENT areas (see reconcilePicks).
  const [rawPicks, setRawPicks]     = React.useState<AreaPick[]>([]);
  const [sheetArea, setSheetArea]   = React.useState<FilmAcademyInterestArea | null>(null);
  const [motivation, setMotivation] = React.useState('');
  const [experience, setExperience] = React.useState('');
  const [pref, setPref]             = React.useState<'one_off' | 'installment'>('installment');
  const [busy, setBusy]             = React.useState(false);
  const [error, setError]           = React.useState<string | null>(null);

  // The cap is served by the API, not hardcoded here: it is a commercial rule and
  // the server is what enforces it. This only stops the user reaching a rejection.
  const maxAreas = data?.maxInterestAreas ?? 2;

  // Picks re-bound to what this batch offers NOW: a pick whose area, option or
  // boarding is no longer offered is dropped rather than submitted into a 400,
  // and prices always reflect the latest overview.
  const picks = React.useMemo(
    () => reconcilePicks(rawPicks, interestAreas, maxAreas),
    // interestAreas is re-derived every render from `data` + `batchId`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawPicks, data, batchId, maxAreas],
  );
  const atLimit = picks.length >= maxAreas;

  // TUITION for the chosen options — payable on ACCEPTANCE and refundable. It is
  // shown so the applicant knows the commitment, but it is NOT collected here:
  // charging it at submit would take tuition before anyone had read the
  // application, under a fee the settings mark non-refundable. The SERVER
  // re-prices every selection from the database at submit, so this total is a
  // display convenience and cannot be used to pay less.
  const summary = summarise(picks);

  // The only amount charged at submit. Non-refundable.
  const applicationFee = baseFee;

  // What actually gets submitted: the account's value, or — only where the
  // account had none — what the user typed into the one input we still show.
  const applicantName  = known.fullName || fullName.trim();
  const applicantEmail = known.email;
  const applicantPhone = known.phone || phone.trim();

  const pickFor = (slug: string) => picks.find((p) => p.area.slug === slug);

  const onPicked = (
    area: FilmAcademyInterestArea,
    choice: { option: FilmAcademyAreaOption; boarding: boolean },
  ) => {
    setRawPicks(upsertPick(picks, { area, option: choice.option, boarding: choice.boarding }, maxAreas));
    setSheetArea(null);
    setError(null);
  };

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
        // The server derives areas_of_interest from these and prices each one
        // itself from the database; no amount is ever sent.
        selections: toSelections(picks),
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
    // that can apply — say so rather than showing an input we would ignore.
    if (!applicantEmail)     return setError('Please sign in to apply.');
    if (!applicantName)      return setError('Enter your full name.');
    if (!applicantPhone)     return setError('Enter your phone number.');
    if (picks.length === 0)  return setError('Choose at least one area of interest.');
    if (picks.length > maxAreas) {
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
        <HomeMenuButton />
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

        <View style={styles.areasHead}>
          <Text style={styles.label}>Areas of interest</Text>
          <Text
            style={[styles.noticeText, atLimit && styles.limitReached]}
            accessibilityLiveRegion="polite"
          >
            {atLimit
              ? `${picks.length} of ${maxAreas} chosen — remove one to swap it.`
              : `${picks.length} of ${maxAreas} chosen. Tap an area to pick a course option.`}
          </Text>
          <Text style={styles.totalNote}>
            Amounts shown are tuition, payable only if you are offered a place.
          </Text>
        </View>
        {interestAreas.length === 0 ? (
          <Text style={styles.noticeText}>
            No areas are available to choose right now. Please try again later.
          </Text>
        ) : (
          <View style={styles.areaList}>
            {interestAreas.map((a) => {
              const pick = pickFor(a.slug);
              return (
                <AreaCard
                  key={a.slug}
                  area={a}
                  pick={pick}
                  blocked={!pick && !canAddArea(picks, a, maxAreas)}
                  onOpen={() => setSheetArea(a)}
                  onRemove={() => setRawPicks(removePick(picks, a.slug))}
                />
              );
            })}
          </View>
        )}


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

        {/* Hosts the Paystack checkout WebView on native; renders nothing on web. */}
        <gateway.Sheet />
      </ScrollView>

      {/* Sticky summary: always visible above the submit action, so the
          applicant sees exactly what they are committing to before paying. */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        {picks.length > 0 ? (
          <View style={styles.footerLines}>
            {picks.map((p) => {
              const price = optionPrice(p.option, p.boarding);
              const priceText = price === null ? '—' : naira(price);
              return (
                <View
                  key={p.area.slug}
                  style={styles.footerLine}
                  accessible
                  accessibilityLabel={`${p.area.label}, ${p.option.label}, ${
                    p.boarding ? 'with boarding' : 'without boarding'
                  }, ${priceText}`}
                >
                  <Text style={styles.footerLineLabel} numberOfLines={2}>
                    {p.area.label} — {p.option.label}
                  </Text>
                  {p.boarding && <BoardingBadge />}
                  <Text style={styles.footerLineValue}>{priceText}</Text>
                </View>
              );
            })}
            <View style={styles.footerRow}>
              <Text style={styles.footerLabel}>Tuition if accepted</Text>
              <Text style={styles.footerValue}>{naira(summary.total)}</Text>
            </View>
            <Text style={styles.totalNote}>
              Payable only if you are offered a place, and refundable. Nothing for
              tuition is taken today.
            </Text>
          </View>
        ) : (
          <Text style={styles.totalNote}>No areas chosen yet.</Text>
        )}

        <View style={[styles.footerRow, styles.footerPayRow]}>
          <View style={styles.footerPayText}>
            <Text style={styles.totalGrandLabel}>Pay now</Text>
            <Text style={styles.totalNote}>Application fee · non-refundable</Text>
          </View>
          <Text style={styles.totalGrandValue}>{naira(baseFee)}</Text>
        </View>

        {!!error && (
          <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
        )}

        <PrimaryButton
          label={feeRequired
            ? `Pay ${naira(applicationFee)} & submit`
            : 'Submit application'}
          onPress={onSubmit}
          loading={busy}
        />
      </View>

      {!!sheetArea && (
        <AreaOptionSheet
          area={sheetArea}
          initial={(() => {
            const p = pickFor(sheetArea.slug);
            return p ? { option_id: p.option.id, boarding: p.boarding } : undefined;
          })()}
          onSelect={(choice) => onPicked(sheetArea, choice)}
          onClose={() => setSheetArea(null)}
        />
      )}
    </SafeAreaView>
  );
}

const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`;

function BoardingBadge() {
  return (
    <View style={styles.badge}>
      <BedDouble size={12} color={Colors.primary} />
      <Text style={styles.badgeText}>Boarding</Text>
    </View>
  );
}

/**
 * One area of interest. Tapping opens the option sheet (re-opening it with the
 * current choice when already picked). Areas with no active options cannot be
 * applied for and are shown disabled; at the cap, unpicked areas are disabled.
 */
function AreaCard({ area, pick, blocked, onOpen, onRemove }: {
  area: FilmAcademyInterestArea;
  pick: AreaPick | undefined;
  blocked: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const priced = hasOptions(area);
  const from = fromPrice(area);
  const disabled = !priced || blocked;
  const price = pick ? optionPrice(pick.option, pick.boarding) : null;

  const a11y = pick
    ? `${area.label}, chosen: ${pick.option.label}${
        pick.option.duration_label ? `, ${pick.option.duration_label}` : ''
      }, ${pick.boarding ? 'with boarding' : 'without boarding'}${
        price !== null ? `, ${naira(price)}` : ''
      }. Tap to change.`
    : !priced
      ? `${area.label}, pricing coming soon, unavailable`
      : blocked
        ? `${area.label}, from ${naira(from ?? 0)}, unavailable — limit reached`
        : `${area.label}, from ${naira(from ?? 0)}. Tap to choose an option.`;

  return (
    <View style={[styles.areaCard, pick && styles.areaCardOn, disabled && styles.areaCardOff]}>
      <Pressable
        onPress={onOpen}
        disabled={disabled}
        style={({ pressed }) => [styles.areaMain, pressed && styles.areaPressed]}
        accessibilityRole="button"
        accessibilityState={{ selected: !!pick, disabled }}
        accessibilityLabel={a11y}
      >
        <View style={[styles.areaTick, pick && styles.areaTickOn]}>
          {pick && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
        </View>
        <View style={styles.areaBody}>
          <Text style={styles.areaLabel}>{area.label}</Text>
          {pick ? (
            <>
              <Text style={styles.areaChoice}>
                {pick.option.label}
                {pick.option.duration_label ? ` · ${pick.option.duration_label}` : ''}
              </Text>
              <View style={styles.areaChoiceRow}>
                {pick.boarding
                  ? <BoardingBadge />
                  : <Text style={styles.areaMeta}>Without boarding</Text>}
              </View>
            </>
          ) : !priced ? (
            <Text style={styles.areaMeta}>Pricing coming soon</Text>
          ) : (
            <Text style={styles.areaFrom}>
              from {naira(from ?? 0)}
              {blocked ? <Text style={styles.areaMeta}>  ·  limit reached</Text> : null}
            </Text>
          )}
        </View>
        {pick && price !== null ? (
          <Text style={styles.areaPrice}>{naira(price)}</Text>
        ) : priced && !blocked ? (
          <ChevronRight size={20} color={Colors.onSurfaceVariant} />
        ) : null}
      </Pressable>

      {pick && (
        <View style={styles.areaActions}>
          <Pressable
            onPress={onOpen}
            style={styles.areaAction}
            accessibilityRole="button"
            accessibilityLabel={`Change option for ${area.label}`}
          >
            <Text style={styles.areaActionText}>Change</Text>
          </Pressable>
          <Pressable
            onPress={onRemove}
            style={styles.areaAction}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${area.label}`}
          >
            <Trash2 size={16} color={Colors.error} />
            <Text style={[styles.areaActionText, styles.areaRemoveText]}>Remove</Text>
          </Pressable>
        </View>
      )}
    </View>
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
  chipText:    { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextOn:  { color: Colors.primary },
  totalGrandLabel: { ...Typography.labelLg, color: Colors.onSurface },
  totalGrandValue: { ...Typography.titleMd, color: Colors.onSurface },
  totalNote:     { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  error:       { ...Typography.bodyMd, color: Colors.error },
  noticeBox:   { backgroundColor: Colors.iconBgGold, borderRadius: Radius.lg, padding: Spacing.lg, gap: 4 },
  noticeTitle: { ...Typography.labelLg, color: Colors.onSurface },
  noticeText:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  limitReached: { color: Colors.onWarning },

  // Area cards (open the option sheet).
  areasHead:   { gap: Spacing.xs },
  areaList:    { gap: Spacing.sm },
  areaCard:    { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
                 borderWidth: 1.5, borderColor: Colors.outlineVariant, overflow: 'hidden' },
  areaCardOn:  { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  areaCardOff: { opacity: 0.5, backgroundColor: Colors.surfaceContainerLow },
  areaMain:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 64,
                 paddingVertical: Spacing.md, paddingHorizontal: Spacing.md },
  areaPressed: { opacity: 0.85 },
  areaTick:    { width: 24, height: 24, borderRadius: Radius.full, borderWidth: 2,
                 borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  areaTickOn:  { borderColor: Colors.primary, backgroundColor: Colors.primary },
  areaBody:    { flex: 1, gap: 2 },
  areaLabel:   { ...Typography.labelLg, color: Colors.onSurface },
  areaFrom:    { ...Typography.bodySm, color: Colors.secondary },
  areaMeta:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  areaChoice:  { ...Typography.bodySm, color: Colors.onSurface },
  areaChoiceRow: { flexDirection: 'row', marginTop: 2 },
  areaPrice:   { ...Typography.titleMd, color: Colors.onSurface },
  areaActions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  areaAction:  { flex: 1, minHeight: 48, flexDirection: 'row', gap: Spacing.xs,
                 alignItems: 'center', justifyContent: 'center' },
  areaActionText: { ...Typography.labelMd, color: Colors.primary },
  areaRemoveText: { color: Colors.error },

  badge:       { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
                 backgroundColor: Colors.iconBgPurple, borderRadius: Radius.sm,
                 paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  badgeText:   { ...Typography.labelSm, color: Colors.primary },

  // Sticky summary + submit.
  footer:      { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl,
                 borderTopRightRadius: Radius.xl, paddingHorizontal: Spacing.containerMargin,
                 paddingTop: Spacing.md, gap: Spacing.sm, ...shadow2 },
  footerLines: { gap: Spacing.xs },
  footerLine:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  footerLineLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  footerLineValue: { ...Typography.bodySm, color: Colors.onSurface },
  footerRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  footerLabel: { ...Typography.labelLg, color: Colors.onSurface },
  footerValue: { ...Typography.labelLg, color: Colors.onSurface },
  footerPayRow: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant, paddingTop: Spacing.sm },
  footerPayText: { flex: 1 },
});
