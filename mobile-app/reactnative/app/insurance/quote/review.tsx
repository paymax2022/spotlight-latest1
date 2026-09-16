// ── Protection — review & confirm ────────────────────────────────────────────
// The last screen before money moves. It shows the premium the INSURER returned
// — never a number this app worked out — alongside the answers that produced it,
// so a wrong date of birth or declared value is caught here rather than on a
// certificate.
//
// Confirming calls POST /policies with the draft's idempotency key. That key was
// minted once when the draft was created and is reused verbatim on every retry:
// a fresh key on retry is how one policy becomes two charges.
//
// The result is decided by the POLICY that comes back, not by the payment step.
// A purchase can fail at the insurer after the payment leg looks fine, so
// "success" means we are holding a confirmed policy and nothing less.

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Pencil, ShieldCheck } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import {
  InsuranceErrorBanner,
  UnderwriterRow,
} from '@/features/insurance/components/live';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import { discardDraft, getDraft, updateDraft } from '@/features/insurance/live/draft';
import {
  asText,
  buildInputs,
  fallbackPlanOptions,
  isVisible,
  priceDrivingFields,
} from '@/features/insurance/live/formEngine';
import {
  useCreateLiveQuote,
  useProductSchema,
  usePurchasePolicy,
} from '@/features/insurance/live/hooks';
import { coverPeriodLabel, nairaFromKobo } from '@/features/insurance/live/money';
import type { Field, InsuranceError } from '@/features/insurance/live/types';

export default function ReviewAndConfirm() {
  const { draft: draftId } = useLocalSearchParams<{ draft?: string }>();
  const draft = getDraft(draftId);
  const schema = useProductSchema(draft?.product.code ?? '', !!draft);
  const purchase = usePurchasePolicy();
  const requote = useCreateLiveQuote();
  const [confirmed, setConfirmed] = useState(false);
  // Local mirror of the draft so a re-quote re-renders this screen.
  const [tick, setTick] = useState(0);

  const fields: Field[] = useMemo(
    () => schema.data?.fields ?? draft?.product.formSchema?.fields ?? [],
    [schema.data, draft],
  );

  const priceLevers = useMemo(() => priceDrivingFields(fields), [fields]);

  // A draft lives in memory for the length of one attempt. Coming back to this
  // route later (deep link, app restart) finds nothing, and inventing a summary
  // would be worse than saying so.
  if (!draft || !draft.quote) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review" />
        <StateView
          kind="empty"
          title="This application has expired"
          message="For your security we don't keep an unfinished application. Start again and it only takes a minute."
          icon="FileClock"
          actionLabel="Start again"
          onAction={() => router.replace('/insurance/browse')}
        />
      </SafeAreaView>
    );
  }

  const { product, quote, values } = draft;
  void tick; // re-render key after a re-quote mutates the draft in place.

  /**
   * Change a price-driving answer and ask the insurer to re-price. The premium
   * shown is always the one that came back — we never scale the old number.
   */
  const reprice = async (name: string, next: string) => {
    const nextValues = { ...values, [name]: next };
    updateDraft(draft.id, { values: nextValues });
    setTick((t) => t + 1);
    try {
      const priced = await requote.mutateAsync({
        productCode: product.code,
        inputs: buildInputs(fields, nextValues),
      });
      updateDraft(draft.id, { quote: priced });
    } finally {
      setTick((t) => t + 1);
    }
  };

  const answers = fields
    .filter((f) => !f.hidden && isVisible(f, values))
    .map((f) => ({ field: f, text: displayValue(f, asText(values[f.name])) }))
    .filter((a) => a.text);

  const confirm = async () => {
    try {
      const policy = await purchase.mutateAsync({
        quoteRef: quote.quoteRef,
        productCode: product.code,
        inputs: buildInputs(fields, values),
        idempotencyKey: draft.idempotencyKey,
      });
      // Success is the CONFIRMED policy, not the payment leg. Anything short of
      // a policy id is a failure, however far the payment appeared to get.
      if (!policy?.id) {
        router.replace(`/insurance/pay/failure?draft=${draft.id}&code=NO_POLICY_RETURNED`);
        return;
      }
      discardDraft(draft.id);
      router.replace(`/insurance/pay/success?id=${encodeURIComponent(policy.id)}`);
    } catch (err) {
      const code = (err as InsuranceError)?.code ?? 'PURCHASE_FAILED';
      router.replace(
        `/insurance/pay/failure?draft=${draft.id}&code=${encodeURIComponent(code)}`,
      );
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review your cover" subtitle={product.name} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* The price, as the insurer quoted it. */}
        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>Premium to pay</Text>
          <Text style={styles.priceValue}>{nairaFromKobo(quote.premiumKobo)}</Text>
          <View style={styles.priceMetaRow}>
            <Text style={styles.priceMeta}>
              {coverPeriodLabel(product.coverPeriodDays)}
            </Text>
            {quote.sumInsuredKobo > 0 ? (
              <>
                <View style={styles.dot} />
                <Text style={styles.priceMeta}>
                  cover up to {nairaFromKobo(quote.sumInsuredKobo, { decimals: false })}
                </Text>
              </>
            ) : null}
          </View>
          {quote.expiresAt ? (
            <Text style={styles.priceExpiry}>This price holds until {formatWhen(quote.expiresAt)}.</Text>
          ) : null}
        </View>

        {/* Price levers. The premium genuinely moves with these — the insurer
            returns ₦4,000 for one payment and ₦48,000 for twelve — so they
            belong beside the price, and every change is re-priced by the
            insurer rather than scaled here. */}
        {priceLevers.map((lever) => {
          const options = fallbackPlanOptions(lever);
          if (options.length < 2) return null;
          const current = asText(values[lever.name]);
          return (
            <View key={lever.name} style={styles.leverBlock}>
              <View style={styles.leverHead}>
                <Text style={styles.leverTitle}>{lever.label}</Text>
                {requote.isPending ? (
                  <View style={styles.leverBusy}>
                    <ActivityIndicator size="small" color={InsuranceColors.brand} />
                    <Text style={styles.leverBusyText}>Re-pricing…</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.leverRow}>
                {options.map((o) => {
                  const active = o.value === current;
                  return (
                    <Pressable
                      key={o.value}
                      onPress={() => (active ? undefined : reprice(lever.name, o.value))}
                      disabled={requote.isPending}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      style={[styles.lever, active && styles.leverActive]}
                    >
                      <Text style={[styles.leverLabel, active && styles.leverLabelActive]}>
                        {o.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
        {requote.isError ? <InsuranceErrorBanner error={requote.error} /> : null}

        <UnderwriterRow
          underwriter={quote.underwriter || product.underwriter}
          logoUrl={product.underwriterLogoUrl}
          aggregator={product.aggregator === 'mycover' ? 'MyCover.ai' : product.aggregator}
        />

        {/* The answers behind the price. */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Your details</Text>
            <Pressable
              onPress={() =>
                router.replace(
                  `/insurance/quote/form?code=${encodeURIComponent(product.code)}&draft=${draft.id}`,
                )
              }
              hitSlop={8}
              style={styles.editBtn}
              accessibilityLabel="Edit your details"
            >
              <Pencil size={14} color={InsuranceColors.brand} />
              <Text style={styles.editLabel}>Edit</Text>
            </Pressable>
          </View>
          {answers.map(({ field, text }) => (
            <View key={field.name} style={styles.answerRow}>
              <Text style={styles.answerLabel}>{field.label}</Text>
              <Text style={styles.answerValue} numberOfLines={2}>
                {text}
              </Text>
            </View>
          ))}
        </View>

        {quote.terms ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Terms</Text>
            <Text style={styles.terms}>{quote.terms}</Text>
          </View>
        ) : null}

        {purchase.isError ? <InsuranceErrorBanner error={purchase.error} /> : null}

        {/* Consent — explicit, and what it covers is spelled out. */}
        <Pressable
          style={styles.consentRow}
          onPress={() => setConfirmed((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmed }}
        >
          <View style={[styles.checkbox, confirmed && styles.checkboxOn]}>
            {confirmed ? <ShieldCheck size={14} color={Colors.onPrimary} strokeWidth={2.6} /> : null}
          </View>
          <Text style={styles.consentText}>
            The answers above are true and complete, and I agree to share them with{' '}
            {quote.underwriter || product.underwriter || 'the insurer'} so this policy can be
            issued.
          </Text>
        </Pressable>

        <Text style={styles.footnote}>
          You are charged only if the insurer issues the policy. If it can't be issued, you are not
          charged.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={`Pay ${nairaFromKobo(quote.premiumKobo)}`}
          onPress={confirm}
          disabled={!confirmed}
          loading={purchase.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

/** Render an answer the way a person wrote it, not the way the wire carries it. */
function displayValue(field: Field, raw: string): string {
  if (!raw) return '';
  switch (field.type) {
    case 'money':
      return nairaFromKobo(Math.round(Number(raw.replace(/[^\d.]/g, '') || 0) * 100));
    case 'select': {
      return field.options?.find((o) => o.value === raw)?.label ?? raw;
    }
    case 'image':
    case 'file':
      return 'Attached';
    case 'nin':
      // Never re-display a full national ID number back on a review screen.
      return raw.length >= 4 ? `••••••• ${raw.slice(-4)}` : '•••••••';
    default:
      return raw;
  }
}

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'shortly';
  return new Date(t).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 32, gap: Spacing.md },

  priceCard: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  priceLabel: { ...Typography.labelSm, color: Colors.inversePrimary },
  priceValue: { ...Typography.headlineLg, color: Colors.onPrimary },
  priceMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  priceMeta: { ...Typography.labelSm, color: Colors.inversePrimary },
  dot: { width: 3, height: 3, borderRadius: Radius.full, backgroundColor: Colors.inversePrimary },
  priceExpiry: { ...Typography.labelSm, color: Colors.inversePrimary, marginTop: Spacing.sm },

  card: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editLabel: { ...Typography.labelMd, color: InsuranceColors.brand },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: 5,
  },
  answerLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  answerValue: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  terms: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },

  leverBlock: { gap: Spacing.sm },
  leverHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  leverTitle: { ...Typography.labelLg, color: Colors.onSurface },
  leverBusy: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  leverBusyText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  leverRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  lever: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  leverActive: { borderColor: InsuranceColors.brand, backgroundColor: Colors.iconBgPurple },
  leverLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  leverLabelActive: { color: InsuranceColors.brand, fontWeight: '700' as const },

  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: Colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: InsuranceColors.brand, borderColor: InsuranceColors.brand },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 20 },
  footnote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },

  footer: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
