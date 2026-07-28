import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Pressable, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import DatePickerField from '@/components/DatePickerField';
import SelectableCard from '@/features/mobility/components/SelectableCard';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import {
  useZones, useEligibleItems, useCreateDraft, useQuote, useSubmit, usePayCampaign,
} from '@/features/featured/hooks';
import { formatNaira, todayIso, addDays, durationDays, formatDate } from '@/features/featured/utils';
import type {
  EligibleItem, Zone, Creative, Quote, Campaign, CreateDraftRequest,
} from '@/features/featured/types';

const STEP_TITLES = [
  'Choose what to promote',
  'Pick a placement',
  'Set your run dates',
  'Customize your creative',
  'Review your quote',
  'Confirm & pay',
];
const STEP_DESCRIPTIONS = [
  'Select one of your eligible listings or products.',
  'Where should your promotion appear?',
  'Choose a duration package and a start date.',
  'Tune the headline, image and call-to-action.',
  'Pricing is locked from the server quote.',
  'Pay from your wallet to go live.',
];

const DURATION_PACKAGES = [
  { days: 1, label: '1 day', hint: 'Quick boost' },
  { days: 3, label: '3 days', hint: 'Weekend push' },
  { days: 7, label: '7 days', hint: 'Save 5%' },
  { days: 14, label: '14 days', hint: 'Save 10%' },
  { days: 30, label: '30 days', hint: 'Save 15% · best value' },
];

const NEXT_YEAR = new Date().getFullYear() + 1;

function LocalProgress({ stepIndex, stepCount, title, description }: { stepIndex: number; stepCount: number; title: string; description: string }) {
  const pct = Math.round(((stepIndex + 1) / stepCount) * 100);
  return (
    <View style={s.progress}>
      <View style={s.progressRow}>
        <Text style={s.progressCounter}>Step {stepIndex + 1} of {stepCount}</Text>
        <Text style={s.progressPct}>{pct}%</Text>
      </View>
      <View style={s.track}><View style={[s.fill, { width: `${pct}%` }]} /></View>
      <Text style={s.progressTitle}>{title}</Text>
      <Text style={s.progressDesc}>{description}</Text>
    </View>
  );
}

export default function FeaturedWizardScreen() {
  const zonesQ = useZones();
  const itemsQ = useEligibleItems();
  const createDraft = useCreateDraft();
  const quoteM = useQuote();
  const submit = useSubmit();
  const payCampaign = usePayCampaign();
  // Shared checkout: pay the booking from wallet OR card.
  const pay = usePurchasePayment<Campaign>();

  const [stepIndex, setStepIndex] = React.useState(0);

  // ── wizard form state ──────────────────────────────────────────────────────
  const [item, setItem] = React.useState<EligibleItem | null>(null);
  const [zone, setZone] = React.useState<Zone | null>(null);
  const [durDays, setDurDays] = React.useState<number>(7);
  const [startDate, setStartDate] = React.useState<string>(todayIso());
  const [creative, setCreative] = React.useState<Creative>({ headline: '', image_ref: '', cta: '', deep_link: '' });

  // Server-owned artefacts produced as the user advances.
  const [draft, setDraft] = React.useState<Campaign | null>(null);
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [busyMsg, setBusyMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const zones = zonesQ.data ?? [];
  const items = itemsQ.data ?? [];
  const spec = zone?.creative_spec;

  // Prefill creative from the chosen item + zone defaults.
  React.useEffect(() => {
    if (!item) return;
    setCreative((prev) => ({
      headline: prev.headline || item.default_headline || item.label,
      image_ref: prev.image_ref || item.image_ref || '',
      cta: prev.cta || item.default_cta || spec?.cta_suggestions?.[0] || 'View',
      deep_link: item.deep_link,
    }));
  }, [item, spec]);

  const endDate = addDays(startDate, durDays);
  const isLastStep = stepIndex === STEP_TITLES.length - 1;

  const canNext = (): boolean => {
    switch (stepIndex) {
      case 0: return !!item;
      case 1: return !!zone;
      case 2: return !!startDate && durDays > 0;
      case 3: return creative.headline.trim().length > 0 && creative.cta.trim().length > 0;
      case 4: return !!quote;
      default: return true;
    }
  };

  // Build draft + fetch quote when entering the review step.
  const ensureQuote = async (): Promise<boolean> => {
    if (!item || !zone) return false;
    try {
      setErr(null);
      setBusyMsg('Building your draft…');
      const req: CreateDraftRequest = {
        subject_type: item.subject_type,
        subject_id: item.subject_id,
        subject_label: item.label,
        zone_code: zone.zone_code,
        window_start: startDate,
        window_end: endDate,
        creative,
      };
      const d = draft ?? (await createDraft.mutateAsync(req));
      setDraft(d);
      setBusyMsg('Getting your quote…');
      const q = await quoteM.mutateAsync(d.id);
      setQuote(q);
      setBusyMsg(null);
      return true;
    } catch (e) {
      setBusyMsg(null);
      setErr(e instanceof Error ? e.message : 'Could not price this campaign.');
      return false;
    }
  };

  const handleNext = async () => {
    if (!canNext()) return;
    // Leaving the customize step → produce the locked quote before review.
    if (stepIndex === 3) {
      const ok = await ensureQuote();
      if (!ok) return;
    }
    setStepIndex((i) => Math.min(i + 1, STEP_TITLES.length - 1));
  };

  const handleBack = () => {
    if (stepIndex === 0) { router.back(); return; }
    setStepIndex((i) => Math.max(0, i - 1));
  };

  // Confirm & pay — reuse the shared wallet/card sheet. The `charge` runs
  // submit → pay, each with its own per-attempt Idempotency-Key (generated
  // inside the hooks). On success we route to My Promotions.
  const onPay = () => {
    if (!draft || !quote) return;
    pay.start({
      amountKobo: quote.quoted_price_kobo,
      title: 'Pay for placement',
      charge: async () => {
        await submit.mutateAsync(draft.id);
        return payCampaign.mutateAsync(draft.id);
      },
      onPaid: () => {
        router.replace('/featured/promotions');
      },
    });
  };

  // ── render ─────────────────────────────────────────────────────────────────
  if (zonesQ.isLoading || itemsQ.isLoading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScreenHeader title="Promote" subtitle="Featured Placement" />
        <StateView kind="loading" message="Loading placement options…" />
      </SafeAreaView>
    );
  }
  if (zonesQ.isError) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScreenHeader title="Promote" subtitle="Featured Placement" />
        <StateView kind="error" title="Couldn't load placements" actionLabel="Retry" onAction={() => zonesQ.refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Promote" subtitle="Featured Placement" />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <LocalProgress
          stepIndex={stepIndex}
          stepCount={STEP_TITLES.length}
          title={STEP_TITLES[stepIndex]}
          description={STEP_DESCRIPTIONS[stepIndex]}
        />

        <ScrollView contentContainerStyle={s.form} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {err ? (
            <View style={s.banner}><Text style={s.bannerText}>{err}</Text></View>
          ) : null}

          {/* Step 1 — pick an eligible item */}
          {stepIndex === 0 && (
            <View style={s.cardList}>
              {items.length === 0 ? (
                <StateView kind="empty" compact icon="PackageOpen" title="Nothing to promote yet" message="You have no eligible listings or products." />
              ) : (
                items.map((it) => (
                  <SelectableCard
                    key={it.subject_id}
                    title={it.label}
                    subtitle={it.subtitle}
                    icon="Megaphone"
                    selected={item?.subject_id === it.subject_id}
                    onPress={() => setItem(it)}
                  />
                ))
              )}
            </View>
          )}

          {/* Step 2 — pick a zone, with availability hint */}
          {stepIndex === 1 && (
            <View style={s.cardList}>
              {zones.map((z) => {
                const free = Math.max(0, z.slots_total - z.slots_taken);
                const limited = free > 0 && free <= 2;
                const sold = free === 0;
                const hint = sold ? 'Sold out' : limited ? `Only ${free} slot${free > 1 ? 's' : ''} left` : `${free} slots available`;
                return (
                  <SelectableCard
                    key={z.zone_code}
                    title={z.name}
                    subtitle={`${hint} · ${formatNaira(z.base_daily_rate_kobo)}/day`}
                    icon={z.layout_type === 'hero' ? 'Image' : z.layout_type === 'carousel' ? 'GalleryHorizontal' : 'LayoutGrid'}
                    selected={zone?.zone_code === z.zone_code}
                    disabled={sold}
                    onPress={() => { setZone(z); setQuote(null); }}
                  />
                );
              })}
            </View>
          )}

          {/* Step 3 — duration package + start date */}
          {stepIndex === 2 && (
            <View>
              <Text style={s.fieldLabel}>Duration</Text>
              <View style={s.cardList}>
                {DURATION_PACKAGES.map((p) => (
                  <SelectableCard
                    key={p.days}
                    title={p.label}
                    subtitle={p.hint}
                    icon="CalendarRange"
                    selected={durDays === p.days}
                    onPress={() => { setDurDays(p.days); setQuote(null); }}
                  />
                ))}
              </View>
              <Text style={[s.fieldLabel, { marginTop: Spacing.lg }]}>Start date</Text>
              <DatePickerField
                label="Start date"
                value={startDate}
                onChange={(d) => { setStartDate(d); setQuote(null); }}
                minYear={new Date().getFullYear()}
                maxYear={NEXT_YEAR}
              />
              <View style={[s.infoCard]}>
                <Text style={s.infoText}>Runs {formatDate(startDate)} → {formatDate(endDate)} ({durationDays(startDate, endDate)} days).</Text>
              </View>
            </View>
          )}

          {/* Step 4 — customize creative per zone spec */}
          {stepIndex === 3 && (
            <View>
              <Text style={s.fieldLabel}>Headline{spec?.headline_max ? ` (max ${spec.headline_max})` : ''}</Text>
              <TextInput
                style={s.input}
                value={creative.headline}
                maxLength={spec?.headline_max}
                onChangeText={(t) => setCreative((c) => ({ ...c, headline: t }))}
                placeholder="Catchy headline"
                placeholderTextColor={Colors.outline}
              />
              <Text style={s.fieldLabel}>Image URL</Text>
              <TextInput
                style={s.input}
                value={creative.image_ref}
                onChangeText={(t) => setCreative((c) => ({ ...c, image_ref: t }))}
                placeholder="https://…"
                placeholderTextColor={Colors.outline}
                autoCapitalize="none"
              />
              {spec?.image_hint ? <Text style={s.hint}>{spec.image_hint}</Text> : null}
              <Text style={s.fieldLabel}>Call to action{spec?.cta_max ? ` (max ${spec.cta_max})` : ''}</Text>
              <TextInput
                style={s.input}
                value={creative.cta}
                maxLength={spec?.cta_max}
                onChangeText={(t) => setCreative((c) => ({ ...c, cta: t }))}
                placeholder="e.g. Order Now"
                placeholderTextColor={Colors.outline}
              />
              {spec?.cta_suggestions?.length ? (
                <View style={s.chips}>
                  {spec.cta_suggestions.map((sug) => (
                    <Pressable key={sug} style={s.chip} onPress={() => setCreative((c) => ({ ...c, cta: sug }))}>
                      <Text style={s.chipText}>{sug}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          )}

          {/* Step 5 — review quote (locked breakdown) */}
          {stepIndex === 4 && quote && (
            <View>
              <View style={s.summaryCard}>
                <Row label="Placement" value={zone?.name ?? ''} />
                <Row label="Promoting" value={item?.label ?? ''} />
                <Row label="Run" value={`${formatDate(startDate)} → ${formatDate(endDate)}`} />
              </View>
              <Text style={s.fieldLabel}>Price breakdown</Text>
              <View style={s.summaryCard}>
                <Row label={`Daily rate × ${quote.breakdown.duration_days} days`} value={formatNaira(quote.breakdown.base_daily_rate_kobo * quote.breakdown.duration_days)} />
                {quote.breakdown.tier_multiplier !== 1 ? (
                  <Row label="Tier multiplier" value={`× ${quote.breakdown.tier_multiplier.toFixed(2)}`} />
                ) : null}
                {quote.breakdown.duration_discount_pct > 0 ? (
                  <Row label="Duration discount" value={`− ${quote.breakdown.duration_discount_pct}%`} />
                ) : null}
                <Row label="Platform fee" value={formatNaira(quote.breakdown.fees_kobo)} />
                <View style={s.divider} />
                <Row label="Total" value={formatNaira(quote.quoted_price_kobo)} strong />
                <Text style={s.hint}>Rate {quote.rate_version}. Price is locked until you pay.</Text>
              </View>
            </View>
          )}

          {/* Step 6 — confirm & pay */}
          {stepIndex === 5 && quote && (
            <View>
              <View style={s.payHeader}>
                <Text style={s.payAmount}>{formatNaira(quote.quoted_price_kobo)}</Text>
                <Text style={s.paySub}>{zone?.name} · {durationDays(startDate, endDate)} days</Text>
              </View>
              <View style={s.summaryCard}>
                <Row label="Promoting" value={item?.label ?? ''} />
                <Row label="Run" value={`${formatDate(startDate)} → ${formatDate(endDate)}`} />
                <Row label="Headline" value={creative.headline} />
              </View>
              <Text style={s.hint}>You'll pay from your wallet, or by card. Your placement goes live on the start date.</Text>
            </View>
          )}
        </ScrollView>

        {busyMsg ? <Text style={s.busy}>{busyMsg}</Text> : null}

        <View style={s.footer}>
          <Pressable style={s.backBtn} onPress={handleBack} hitSlop={6}>
            <ChevronLeft size={20} color={Colors.onSurface} />
            <Text style={s.backLabel}>Back</Text>
          </Pressable>
          <View style={s.nextWrap}>
            {isLastStep ? (
              <PrimaryButton label="Pay & go live" onPress={onPay} disabled={!quote} loading={pay.phase !== 'idle' && pay.visible} />
            ) : (
              <PrimaryButton
                label={stepIndex === 3 ? 'Get quote' : stepIndex === 4 ? 'Continue to pay' : 'Continue'}
                onPress={handleNext}
                disabled={!canNext()}
                loading={!!busyMsg}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, strong && s.rowLabelStrong]} numberOfLines={1}>{label}</Text>
      <Text style={[s.rowValue, strong && s.rowValueStrong]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  form: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  cardList: { gap: Spacing.sm },
  progress: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, gap: Spacing.xs },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressCounter: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  progressPct: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  track: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden', marginVertical: Spacing.xs },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.primary },
  progressTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  progressDesc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  banner: { backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md },
  bannerText: { ...Typography.labelMd, color: Colors.error },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs, marginTop: Spacing.sm },
  input: {
    ...Typography.bodyMd, color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.transparent, height: 56,
    paddingHorizontal: Spacing.md, marginBottom: Spacing.sm,
  },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
  chip: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 6, borderWidth: 1, borderColor: Colors.outlineVariant },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  infoCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.xs },
  infoText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  summaryCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: 4 },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1 },
  rowLabelStrong: { ...Typography.labelLg, color: Colors.onSurface },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface, maxWidth: '55%', textAlign: 'right' },
  rowValueStrong: { ...Typography.titleMd, color: Colors.primary },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.sm },
  payHeader: { alignItems: 'center', marginVertical: Spacing.md },
  payAmount: { ...Typography.headlineMd, color: Colors.primary },
  paySub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  busy: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', paddingBottom: Spacing.xs },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, backgroundColor: Colors.background,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, paddingRight: Spacing.sm },
  backLabel: { ...Typography.labelLg, color: Colors.onSurface },
  nextWrap: { flex: 1 },
});
