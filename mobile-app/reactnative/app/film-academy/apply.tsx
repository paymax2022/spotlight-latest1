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

import React, { useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronDown, Check } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { getOverview, applyToBatch, FILM_ACADEMY_STATUS_KEY } from '@/features/filmAcademy/api';
import { alertAsync } from '@/lib/confirm';
import { useAuthStore } from '@/store/authStore';
import { normalizeAccountName } from '@/features/account/name';
import AccountDetailsCard from '@/features/account/AccountDetailsCard';
import { usePaystackGateway, PAYSTACK_PUBLIC_KEY } from '@/features/payments';
import { HomeMenuButton } from '@/components/HomeMenu';
import { FILM_ACADEMY_KEY } from './index';

export default function FilmAcademyApplyScreen() {
  const { batchId, area, formats } = useLocalSearchParams<{
    batchId?: string; area?: string; formats?: string;
  }>();
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
  // Only the areas this batch offers — exactly. An empty entry means the batch
  // has no trainings set, and the form shows none rather than inventing the
  // full catalogue; only a wholly absent entry (an older server) is treated as
  // unrestricted.
  const offeredSlugs = batchId ? data?.batchAreas?.[batchId] : undefined;
  const interestAreas = useMemo(
    () => (offeredSlugs === undefined
      ? (data?.interestAreas ?? [])
      : (data?.interestAreas ?? []).filter((a) => offeredSlugs.includes(a.slug))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.interestAreas, data?.batchAreas, batchId],
  );

  const gateway = usePaystackGateway();
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
  // Accordion state: { areaSlug: formatKey } — presence of a slug means the
  // area is selected, and the value is the price line (sub) the applicant
  // tapped. An empty value only ever appears on a legacy server with no
  // format table, where the header tap selects the area directly.
  const [selections, setSelections] = React.useState<Record<string, string>>({});
  const [openSlug, setOpenSlug]     = React.useState<string | null>(null);
  const [motivation, setMotivation] = React.useState('');
  const [experience, setExperience] = React.useState('');
  const [pref, setPref]             = React.useState<'one_off' | 'installment'>('installment');
  const [busy, setBusy]             = React.useState(false);
  const [error, setError]           = React.useState<string | null>(null);

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
  // Pricing comes from the composite format table (five formats per area).
  // The server recomputes the same sum from its own rows, so this total is a
  // display convenience and cannot be used to pay less.
  const structure = data?.pricingStructure ?? [];
  const hasStructure = structure.length > 0
    && interestAreas.some((a) => (a.pricing_options?.length ?? 0) > 0);
  const priceOf = (a: (typeof interestAreas)[number], key: string) =>
    (a.pricing_options ?? []).find((o) => o.key === key)?.price_ngn ?? 0;
  const selectedAreas = interestAreas.filter((a) => selections[a.slug] !== undefined);
  const areaFee = (a: (typeof interestAreas)[number]) =>
    hasStructure ? priceOf(a, selections[a.slug] ?? '') : Number(a.fee_ngn ?? 0);
  const areasTotal = selectedAreas.reduce((sum, a) => sum + areaFee(a), 0);
  // Without the format table (an older server) keep the previous behaviour:
  // the chosen areas' sum, falling back to the batch's flat fee when zero.
  const tuitionTotal = hasStructure
    ? areasTotal
    : areasTotal > 0
      ? areasTotal
      : selectedAreas.length > 0
        ? Number(batch?.training_fee_ngn ?? 0)
        : 0;

  // The only amount charged at submit. Non-refundable.
  const applicationFee = baseFee;

  // ONE payment at submit: the application fee plus the FIRST tuition
  // instalment. Mirrors tuitionPlanShape on the server, which verifies it.
  const billedTuition = tuitionTotal > 0 ? tuitionTotal : Number(batch?.training_fee_ngn ?? 0);
  const payUpfront = pref === 'one_off'
    || !['weekly', 'biweekly', 'monthly'].includes(String(batch?.fee_frequency ?? 'monthly'));
  const instalmentCount = payUpfront ? 1 : Math.min(12, Math.max(1, Number(batch?.installments_count ?? 1)));
  const discountPct = pref === 'one_off' ? Number(batch?.one_off_discount_pct ?? 0) : 0;
  const discountedTuition = Math.round(billedTuition * (1 - discountPct / 100) * 100) / 100;
  const firstTuitionPayment = billedTuition > 0
    ? (instalmentCount === 1 ? discountedTuition : Math.round((discountedTuition / instalmentCount) * 100) / 100)
    : 0;
  const applicationFeeDue = feeRequired ? applicationFee : 0;
  const payNow = applicationFeeDue + firstTuitionPayment;

  // The cap is served by the API, not hardcoded here: it is a commercial rule and
  // the server is what enforces it. This only stops the user reaching a rejection.
  const maxAreas = data?.maxInterestAreas ?? 2;
  const selectedCount = Object.keys(selections).length;
  const atLimit = selectedCount >= maxAreas;

  // The hub hands over what was picked there: `area` lists the trainings,
  // `formats` the slug:key pairs whose price line was tapped. A format choice
  // only lands when the area is offered by this batch AND carries that key —
  // a crafted query cannot select something the server would reject. An area
  // named with no format just opens its accordion; with the legacy fee-per-area
  // server, a named area is selected directly.
  const preselectedSlugs = typeof area === 'string' ? area.split(',').filter(Boolean) : [];
  const preselectedFormats = typeof formats === 'string'
    ? formats.split(',').map((pair) => pair.split(':')).filter((kv) => kv.length === 2)
    : [];
  useEffect(() => {
    if (interestAreas.length === 0) return;
    if (preselectedSlugs.length === 0 && preselectedFormats.length === 0) return;
    setSelections((prev) => {
      const next = { ...prev };
      for (const [slug, key] of preselectedFormats) {
        if (slug in next) continue;
        const areaRow = interestAreas.find((a) => a.slug === slug);
        const knownKey = (areaRow?.pricing_options ?? []).some((o) => o.key === key);
        if (knownKey && Object.keys(next).length < maxAreas) next[slug] = key;
      }
      if (!hasStructure) {
        for (const slug of preselectedSlugs) {
          if (!(slug in next) && interestAreas.some((a) => a.slug === slug)
            && Object.keys(next).length < maxAreas) next[slug] = '';
        }
      }
      return next;
    });
    const first = preselectedFormats[0]?.[0] ?? preselectedSlugs[0];
    if (first) setOpenSlug((prev) => prev ?? first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, formats, interestAreas, maxAreas, hasStructure]);

  // What actually gets submitted: the account's value, or — only where the
  // account had none — what the user typed into the one input we still show.
  const applicantName  = known.fullName || fullName.trim();
  const applicantEmail = known.email;
  const applicantPhone = known.phone || phone.trim();

  // Tapping a sub (price line) selects that area in that format; tapping the
  // selected one again deselects the area. At the cap, a new area cannot be
  // added — its subs are disabled and the limit note explains why.
  const pickSub = (slug: string, key: string) =>
    setSelections((prev) => {
      if (prev[slug] === key) {
        const next = { ...prev };
        delete next[slug];
        return next;
      }
      if (!(slug in prev) && Object.keys(prev).length >= maxAreas) return prev;
      return { ...prev, [slug]: key };
    });

  // Legacy server without the format table: the header itself selects.
  const toggleArea = (slug: string) =>
    setSelections((prev) => {
      if (slug in prev) {
        const next = { ...prev };
        delete next[slug];
        return next;
      }
      if (Object.keys(prev).length >= maxAreas) return prev;
      return { ...prev, [slug]: '' };
    });

  const submitApplication = async (reference?: string) => {
    const selectedSlugs = Object.keys(selections);
    setBusy(true);
    try {
      await applyToBatch({
        batch_id: batchId!,
        // Sent for older servers that still require them. A current server
        // ignores the email and re-derives all three from the session.
        full_name: applicantName,
        email: applicantEmail,
        phone: applicantPhone,
        areas_of_interest: selectedSlugs,
        // The accordion choices: each area with the price line tapped. The
        // server prices tuition from these pairs, area by area.
        ...(hasStructure
          ? { area_selections: selectedSlugs.map((slug) => ({ slug, key: selections[slug] })) }
          : {}),
        motivation: motivation.trim(),
        experience: experience.trim() || undefined,
        payment_preference: pref,
        application_fee_reference: reference,
      });
      await qc.invalidateQueries({ queryKey: FILM_ACADEMY_KEY });
      await qc.invalidateQueries({ queryKey: FILM_ACADEMY_STATUS_KEY });
      await alertAsync({ title: 'You are in', message: 'Your payment was received and your place is secured. You can start learning now.' });
      router.replace('/film-academy/learn');
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
    if (selectedCount === 0) return setError('Tap a training, then tap its price line to choose it.');
    if (selectedCount > maxAreas) {
      return setError(`Choose at most ${maxAreas} areas of interest for this batch.`);
    }
    if (hasStructure && Object.values(selections).some((k) => !k)) {
      return setError('Choose a price line for each training you selected.');
    }
    if (!motivation.trim())  return setError('Tell us why you want to join.');

    // Nothing due (free intake, no tuition) — submit straight away.
    if (payNow <= 0) return submitApplication();

    if (!payReady) {
      return setError('Card payment is unavailable right now. Please try again later.');
    }

    // Collect the single payment FIRST, then submit with its reference. The
    // server re-verifies the reference and amount against Paystack, so nothing
    // here is trusted. Amounts are NAIRA; Paystack takes kobo (x100).
    setBusy(true);
    gateway.open({
      email: applicantEmail,
      amountKobo: Math.round(payNow * 100),
      domain: 'academy_application',
      metadataFields: [
        { display_name: 'Purpose',  variable_name: 'purpose',  value: 'Film Academy application + tuition' },
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
        {payNow > 0 && !payReady && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              Card payment is unavailable right now, so this application cannot be submitted yet.
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
          Tap a training to open it, then tap its price line to choose.
        </Text>
        <Text style={[styles.noticeText, atLimit && styles.limitReached]}>
          {atLimit
            ? `You have chosen ${maxAreas} of ${maxAreas}. Deselect one to swap it.`
            : `Choose up to ${maxAreas} for this batch — ${selectedCount} of ${maxAreas} selected.`}
        </Text>
        {interestAreas.length === 0 ? (
          <Text style={styles.noticeText}>
            No areas are available to choose right now. Please try again later.
          </Text>
        ) : (
          <View style={styles.accList}>
            {interestAreas.map((a) => {
              const chosenKey = selections[a.slug];
              const picked = chosenKey !== undefined;
              const hasFormats = hasStructure && (a.pricing_options?.length ?? 0) > 0;
              const isOpen = openSlug === a.slug;
              const chosenOpt = hasFormats
                ? (a.pricing_options ?? []).find((o) => o.key === chosenKey)
                : undefined;
              const legacyFee = !hasFormats ? Number(a.fee_ngn ?? 0) : 0;
              return (
                <View key={a.slug} style={[styles.accItem, picked && styles.accItemOn]}>
                  <Pressable
                    onPress={() => (hasFormats ? setOpenSlug(isOpen ? null : a.slug) : toggleArea(a.slug))}
                    disabled={!hasFormats && !picked && atLimit}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen, selected: picked }}
                    accessibilityLabel={chosenOpt
                      ? `${a.label}, ${chosenOpt.label} selected`
                      : `${a.label}${picked ? ', selected' : ''}`}
                    style={styles.accHeader}
                  >
                    {!hasFormats && (
                      <View style={[styles.trainingCheck, picked && styles.trainingCheckOn]}>
                        {picked && <Check size={13} color={Colors.black} />}
                      </View>
                    )}
                    <View style={styles.formatBody}>
                      <Text style={[styles.chipText, picked && styles.chipTextOn]}>{a.label}</Text>
                      {chosenOpt ? (
                        <Text style={styles.totalNote}>
                          {chosenOpt.label} — ₦{Number(chosenOpt.price_ngn).toLocaleString('en-NG')}
                        </Text>
                      ) : (
                        !picked && !!a.description && (
                          <Text style={styles.totalNote} numberOfLines={1}>{a.description}</Text>
                        )
                      )}
                      {picked && legacyFee > 0 && (
                        <Text style={styles.totalNote}>₦{legacyFee.toLocaleString('en-NG')}</Text>
                      )}
                    </View>
                    {hasFormats && (
                      <ChevronDown
                        size={18}
                        color={Colors.onSurfaceVariant}
                        style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}
                      />
                    )}
                  </Pressable>
                  {isOpen && hasFormats && (
                    <View style={styles.accSubs}>
                      {(a.pricing_options ?? []).map((o) => {
                        const on = chosenKey === o.key;
                        const blocked = !on && !picked && atLimit;
                        return (
                          <Pressable
                            key={o.key}
                            onPress={() => pickSub(a.slug, o.key)}
                            disabled={blocked}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: on, disabled: blocked }}
                            accessibilityLabel={`${o.label}${o.note ? `, ${o.note}` : ''}, ₦${Number(o.price_ngn).toLocaleString('en-NG')}`}
                            style={[styles.subRow, on && styles.subRowOn, blocked && styles.chipBlocked]}
                          >
                            {on
                              ? <Check size={14} color={Colors.primary} />
                              : <View style={styles.subDot} />}
                            <Text style={[styles.subText, on && styles.chipTextOn]}>
                              {o.label}{o.note ? ` (${o.note})` : ''}
                            </Text>
                            <Text style={[styles.subPrice, on && styles.chipTextOn]}>
                              = ₦{Number(o.price_ngn).toLocaleString('en-NG')}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Running total. Tapping a chip adds or removes its line immediately. */}
        <View style={styles.totalBox}>
          <View style={[styles.totalRow, styles.totalRowGrand, { borderTopWidth: 0, marginTop: 0, paddingTop: 0 }]}>
            <Text style={styles.totalGrandLabel}>Pay now</Text>
            <Text style={styles.totalGrandValue}>₦{payNow.toLocaleString('en-NG')}</Text>
          </View>
          <Text style={styles.totalNote}>
            {applicationFeeDue > 0
              ? `Application fee ₦${applicationFeeDue.toLocaleString('en-NG')} (non-refundable) + `
              : ''}
            {instalmentCount > 1 ? 'first tuition instalment' : 'tuition'}. You start learning as soon as you pay.
          </Text>

          {tuitionTotal > 0 && (
            <>
              <View style={[styles.totalRow, styles.totalRowGrand]}>
                <Text style={styles.totalLabel}>
                  Total tuition{instalmentCount > 1 ? ` (${instalmentCount} instalments)` : ''}
                </Text>
                <Text style={styles.totalValue}>₦{tuitionTotal.toLocaleString('en-NG')}</Text>
              </View>
              {selectedAreas
                .filter((a) => areaFee(a) > 0)
                .map((a) => (
                  <View key={a.slug} style={styles.totalRow}>
                    <Text style={styles.totalSubLabel}>
                      {a.label}
                      {hasStructure && selections[a.slug]
                        ? ` — ${(a.pricing_options ?? []).find((o) => o.key === selections[a.slug])?.label ?? selections[a.slug]}`
                        : ''}
                    </Text>
                    <Text style={styles.totalSubValue}>
                      ₦{areaFee(a).toLocaleString('en-NG')}
                    </Text>
                  </View>
                ))}
              {!hasStructure && areasTotal === 0 && selectedAreas.length > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalSubLabel}>Cohort tuition</Text>
                  <Text style={styles.totalSubValue}>
                    ₦{Number(batch?.training_fee_ngn ?? 0).toLocaleString('en-NG')}
                  </Text>
                </View>
              )}
              <Text style={styles.totalNote}>
                {instalmentCount > 1
                  ? 'The first instalment is paid now; the rest fall due on your plan. '
                  : ''}
                Tuition excludes feeding and project fees
                (script print-out, make-up, props &amp; set design, location —
                ₦20,000 per movie project).
              </Text>
            </>
          )}
        </View>

        {/* What the tuition buys, and what it does not — server-owned copy so
            the phone and the admin console cannot drift apart on promises. */}
        {((data?.deliverables.length ?? 0) > 0 || (data?.feeExclusions.length ?? 0) > 0) && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>Your tuition includes</Text>
            {(data?.deliverables ?? []).map((d) => (
              <Text key={d} style={styles.noticeText}>• {d}</Text>
            ))}
            <Text style={styles.noticeTitle}>Fees exclude</Text>
            {(data?.feeExclusions ?? []).map((d) => (
              <Text key={d} style={styles.noticeText}>• {d}</Text>
            ))}
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

        {!!error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.submit, busy && styles.submitBusy]} onPress={onSubmit} disabled={busy}>
          {busy ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.submitText}>
                    {payNow > 0
                      ? `Pay ₦${payNow.toLocaleString('en-NG')} & apply`
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
  formats:     { gap: 6 },
  formatBody:  { flex: 1, gap: 2 },
  accList:     { gap: 6 },
  accItem:     { borderRadius: Radius.md, backgroundColor: Colors.surface,
                 borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  accItemOn:   { borderColor: Colors.primary },
  accHeader:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 paddingHorizontal: Spacing.md, paddingVertical: 12 },
  accSubs:     { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, padding: Spacing.sm, gap: 4 },
  subRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 paddingHorizontal: Spacing.sm, paddingVertical: 10, borderRadius: Radius.sm },
  subRowOn:    { backgroundColor: Colors.iconBgPurple },
  subDot:      { width: 14, height: 14 },
  subText:     { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1 },
  subPrice:    { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  trainingCheck: { width: 18, height: 18, borderRadius: 9, borderWidth: 1,
                   borderColor: Colors.onSurfaceVariant, alignItems: 'center', justifyContent: 'center' },
  trainingCheckOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
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
  limitReached: { color: Colors.onWarning },
  submit:      { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 14,
                 alignItems: 'center', marginTop: Spacing.sm },
  submitBusy:  { opacity: 0.7 },
  submitText:  { ...Typography.labelLg, color: '#FFFFFF' },
});
