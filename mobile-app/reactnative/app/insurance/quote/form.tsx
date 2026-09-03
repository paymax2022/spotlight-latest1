// ── Protection — the application form ────────────────────────────────────────
// Renders the product family's real MyCover schema through `DynamicForm`. This
// screen contains NO product-specific field knowledge: a Bastion health
// application (gender, an 11-digit NIN, a passport photo, a past date of birth,
// an instalment plan) and an MCG gadget application (device make/model/serial,
// a device value with a ₦50,000 floor, two image URLs) are the same code path.
//
// Submitting prices the application server-side and moves to review. The
// premium is never computed here — for percentage-rated plans we can show an
// indicative figure while the user types, clearly labelled as an estimate, but
// the binding number always comes back from the insurer.

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Info, ShieldCheck } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { useAuthStore } from '@/store/authStore';
import {
  DetailSkeleton,
  DynamicForm,
  InsuranceErrorBanner,
  InsuranceErrorState,
  UnderwriterRow,
} from '@/features/insurance/components/live';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import { createDraft, getDraft, updateDraft } from '@/features/insurance/live/draft';
import {
  declaredValueKobo,
  buildInputs,
  planIdValue,
  prefillFromProfile,
} from '@/features/insurance/live/formEngine';
import {
  useCreateLiveQuote,
  useLiveProduct,
  useProductSchema,
} from '@/features/insurance/live/hooks';
import { indicativePremiumKobo, nairaFromKobo } from '@/features/insurance/live/money';
import { getConsentStatus, grantConsent } from '@/features/insurance/live/api';
import { Pressable } from 'react-native';
import { Check } from 'lucide-react-native';
import type { FormValues, InsuranceError } from '@/features/insurance/live/types';

export default function ApplicationForm() {
  const { code, draft: draftId } = useLocalSearchParams<{ code?: string; draft?: string }>();
  const product = useLiveProduct(code ?? '');
  const schema = useProductSchema(code ?? '');
  const quote = useCreateLiveQuote();
  const user = useAuthStore((s) => s.user);

  const existing = getDraft(draftId);
  const [draftKey, setDraftKey] = useState<string | null>(existing?.id ?? null);
  const [values, setValues] = useState<FormValues>(existing?.values ?? {});
  const [prefilled, setPrefilled] = useState(false);

  // The schema may be embedded in the product payload or served separately;
  // whichever arrives first is what we render.
  const activeSchema = schema.data ?? product.data?.formSchema ?? null;

  // Seed from the signed-in profile and inject the plan's `product_id`. The
  // user never types a UUID — the plan they chose upstream supplies it.
  useEffect(() => {
    if (prefilled || !activeSchema || !product.data) return;
    const seeded = prefillFromProfile(
      activeSchema.fields,
      {
        firstName: firstNameOf(user?.fullName),
        lastName: lastNameOf(user?.fullName),
        email: user?.email ?? '',
        phone: user?.phone ?? '',
      },
      values,
    );
    const planId = planIdValue(product.data);
    for (const f of activeSchema.fields) {
      if (f.hidden && /product_?id/i.test(f.name) && planId) seeded[f.name] = planId;
    }
    setValues(seeded);
    setPrefilled(true);
  }, [activeSchema, product.data, user, prefilled, values]);

  const declaredKobo = useMemo(
    () => (activeSchema ? declaredValueKobo(activeSchema.fields, values) : 0),
    [activeSchema, values],
  );

  const serverFieldErrors = (quote.error as unknown as InsuranceError | null)?.fieldErrors;

  if (product.isLoading || schema.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your application" />
        <DetailSkeleton />
      </SafeAreaView>
    );
  }

  if (product.isError || !product.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your application" />
        <InsuranceErrorState error={product.error} onRetry={() => product.refetch()} />
      </SafeAreaView>
    );
  }

  // A missing schema is not "no fields" — it means we do not know what the
  // insurer requires, and submitting a blank application would be rejected.
  if (schema.isError && !product.data.formSchema) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your application" subtitle={product.data.name} />
        <InsuranceErrorState error={schema.error} onRetry={() => schema.refetch()} />
      </SafeAreaView>
    );
  }

  const p = product.data;

  // Consent is per product and per NDPA version, so it is asked once per product
  // and skipped silently for anyone who has already given it.
  const [hasConsent, setHasConsent] = useState<boolean | null>(null);
  const [consentTicked, setConsentTicked] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Unknown status must not read as "already consented" — default closed.
    setHasConsent(null);
    getConsentStatus(p.code)
      .then((ok) => { if (!cancelled) setHasConsent(ok); })
      .catch(() => { if (!cancelled) setHasConsent(false); });
    return () => { cancelled = true; };
  }, [p.code]);

  const submit = async (submittedValues: FormValues) => {
    if (!activeSchema) return;
    // NDPA: the quote endpoint answers 428 ndpa_consent_required until consent is
    // on record, because pricing SHARES the applicant's details with the
    // underwriter. Record the tick before quoting rather than after, so we never
    // transmit anything the person has not agreed to.
    if (!hasConsent) {
      if (!consentTicked) return;
      try {
        await grantConsent(p.code);
        setHasConsent(true);
      } catch (e) {
        setConsentError('We could not record your consent. Please try again.');
        return;
      }
    }
    const inputs = buildInputs(activeSchema.fields, submittedValues);
    try {
      const priced = await quote.mutateAsync({ productCode: p.code, inputs });
      // Create the draft only once, so the idempotency key survives a user who
      // goes back, edits an answer and submits again.
      const draft =
        (draftKey && updateDraft(draftKey, { values: submittedValues, quote: priced })) ||
        createDraft(p, submittedValues);
      if (!draftKey) {
        updateDraft(draft.id, { quote: priced });
        setDraftKey(draft.id);
      }
      router.push(`/insurance/quote/review?draft=${draft.id}`);
    } catch {
      // `quote.error` is rendered inline; DynamicForm attributes field errors
      // back onto the inputs that caused them.
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your application" subtitle={p.name} />

      <DynamicForm
        schema={activeSchema}
        productCode={p.code}
        values={values}
        onChange={setValues}
        onSubmit={submit}
        submitting={quote.isPending}
        submitLabel="Get my price"
        serverFieldErrors={serverFieldErrors}
        header={
          <View style={styles.header}>
            <UnderwriterRow
              underwriter={p.underwriter}
              logoUrl={p.underwriterLogoUrl}
              aggregator={p.aggregator === 'mycover' ? 'MyCover.ai' : p.aggregator}
            />
            <View style={styles.privacy}>
              <ShieldCheck size={15} color={InsuranceColors.ok} />
              <Text style={styles.privacyText}>
                These answers go to {p.underwriter || 'the insurer'} to issue your policy. We only
                share what they ask for.
              </Text>
            </View>
            {quote.isError ? (
              <View style={styles.bannerWrap}>
                <InsuranceErrorBanner error={quote.error} />
              </View>
            ) : null}
          </View>
        }
        footer={
          p.isPercentage && declaredKobo > 0 ? (
            <View style={styles.estimate}>
              <Info size={16} color={InsuranceColors.warnText} />
              <Text style={styles.estimateText}>
                Roughly {nairaFromKobo(indicativePremiumKobo(declaredKobo, p.rateBps))} at this
                declared value. The insurer confirms the exact premium on the next screen.
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

/** The profile stores one `fullName`; the insurers want the halves separately. */
function firstNameOf(fullName: string | undefined): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return parts[0] ?? '';
}

function lastNameOf(fullName: string | undefined): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

const styles = StyleSheet.create({
  consentBox: { marginTop: Spacing.md, gap: Spacing.xs },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    backgroundColor: InsuranceColors.surfaceAlt,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: InsuranceColors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  consentText: { ...Typography.bodySm, color: InsuranceColors.text, flex: 1, lineHeight: 18 },
  consentEmphasis: { fontWeight: '600', color: InsuranceColors.text },
  consentError: { ...Typography.bodySm, color: InsuranceColors.danger, paddingHorizontal: Spacing.sm },
  safe: { flex: 1 },
  header: { gap: Spacing.sm, marginBottom: Spacing.md },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  privacyText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  bannerWrap: { marginTop: Spacing.xs },
  estimate: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  estimateText: { ...Typography.labelSm, color: InsuranceColors.text, flex: 1, lineHeight: 18 },
});
