// ── Sell — edit an existing listing (LM-001 / LM-002 / EC-010) ───────────────
//
// The compose wizard (sell/compose) is create-only. This route edits the mutable
// fields of an existing listing — title, description, price, and category
// attributes — via PATCH /listings/:id. Editing the CONTENT (title/description/
// attrs) of a LIVE (active) listing sends it back to review on the backend
// (edit-after-approve re-moderation, M1) so a seller can't bait-and-switch an
// approved ad; a price-only edit stays live. The screen surfaces that up front.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { alertAsync } from '@/lib/confirm';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, ShieldAlert, Info } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { MarketColors, formatNaira, conditionLabel } from '@/features/marketplace';
import { estimateFairPriceBand } from '@/features/marketplace/api/sell.api';
import { useSellListing, useSellCategory, useUpdateListing } from '@/features/marketplace/sell.hooks';
import AttributeFields, { normalizeSchema, missingRequired } from '@/features/marketplace/components/sell/AttributeFields';
import { checkBannedPatterns, countWords } from '@/features/marketplace/components/sell/ComposerValidation';
import FairPriceMeter from '@/features/marketplace/components/sell/FairPriceMeter';
import { HomeMenuButton } from '@/components/HomeMenu';

const MIN_DESC_WORDS = 8;

export default function EditListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listingQuery = useSellListing(id ?? null);
  const listing = listingQuery.data;
  const categoryQuery = useSellCategory(listing?.categoryId ?? null);
  const update = useUpdateListing();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [attrs, setAttrs] = useState<Record<string, unknown>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate the form once, when the listing arrives.
  useEffect(() => {
    if (listing && !hydrated) {
      setTitle(listing.title);
      setDescription(listing.description);
      setPriceInput(String(Math.round(listing.priceKobo / 100)));
      setAttrs({ ...(listing.attrs ?? {}) });
      setHydrated(true);
    }
  }, [listing, hydrated]);

  const schema = useMemo(() => normalizeSchema(categoryQuery.data?.attributeSchema), [categoryQuery.data]);
  const priceKobo = Math.round((Number(priceInput.replace(/[^0-9.]/g, '')) || 0) * 100);
  const band = useMemo(() => estimateFairPriceBand(listing?.categoryId), [listing?.categoryId]);

  const bannedMatches = useMemo(() => checkBannedPatterns(`${title} ${description}`), [title, description]);
  const descWords = countWords(description);
  const requiredMissing = missingRequired(schema, attrs);
  const titleValid = title.trim().length >= 1 && title.trim().length <= 100;
  const descValid = descWords >= MIN_DESC_WORDS;
  const priceValid = priceKobo > 0;
  const canSave = hydrated && titleValid && descValid && priceValid && bannedMatches.length === 0 && requiredMissing.length === 0 && !update.isPending;

  // Whether this save changes moderation-relevant content (→ re-review if live).
  const contentChanged = useMemo(() => {
    if (!listing) return false;
    return (
      title.trim() !== listing.title.trim() ||
      description.trim() !== listing.description.trim() ||
      JSON.stringify(attrs) !== JSON.stringify(listing.attrs ?? {})
    );
  }, [listing, title, description, attrs]);
  const willReReview = !!listing && listing.status === 'active' && contentChanged;

  function onChangeAttr(key: string, value: unknown) {
    setAttrs((prev) => ({ ...prev, [key]: value }));
  }

  async function onSave() {
    setShowErrors(true);
    if (!canSave || !id) return;
    try {
      await update.mutateAsync({
        id,
        input: { title: title.trim(), description: description.trim(), priceKobo, attrs },
      });
      await alertAsync({
        title: 'Changes saved',
        message: willReReview
          ? 'Your listing is back under review because you changed its content. It will go live again once approved.'
          : 'Your listing has been updated.',
        buttonLabel: 'Done',
      });
      router.replace('/marketplace/sell' as never);
    } catch (e) {
      await alertAsync({ title: 'Could not save', message: e instanceof Error ? e.message : 'Please try again.' });
    }
  }

  if (listingQuery.isLoading || !hydrated) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header />
        <View style={styles.centre}><Text style={styles.muted}>Loading…</Text></View>
      </SafeAreaView>
    );
  }
  if (listingQuery.isError || !listing) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header />
        <View style={styles.centre}><Text style={styles.muted}>We couldn’t load this listing.</Text></View>
      </SafeAreaView>
    );
  }

  const terminal = listing.status === 'sold' || listing.status === 'removed_policy' || listing.status === 'removed_user';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>Edit listing</Text>
        <Text style={styles.sub}>{conditionLabel(listing.condition)} · {listing.category?.name ?? 'Listing'}</Text>

        {terminal ? (
          <View style={[styles.banner, styles.bannerWarn]}>
            <ShieldAlert size={16} color={MarketColors.danger} />
            <Text style={styles.bannerText}>This listing is {listing.status.replace(/_/g, ' ')} and can no longer be edited.</Text>
          </View>
        ) : willReReview ? (
          <View style={[styles.banner, styles.bannerInfo]}>
            <Info size={16} color={MarketColors.brand} />
            <Text style={styles.bannerText}>Because you changed the content, saving will send this live listing back to review before it shows again. A price-only change stays live.</Text>
          </View>
        ) : null}

        {/* Title */}
        <Field label="Title" error={showErrors && !titleValid ? 'Title must be 1–100 characters.' : null}>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={100} editable={!terminal} placeholder="What are you selling?" placeholderTextColor={MarketColors.muted} />
          <Text style={styles.hint}>{title.trim().length}/100</Text>
        </Field>

        {/* Description */}
        <Field label="Description" error={showErrors && !descValid ? `Add a bit more detail (at least ${MIN_DESC_WORDS} words).` : null}>
          <TextInput style={[styles.input, styles.textarea]} value={description} onChangeText={setDescription} multiline editable={!terminal} placeholder="Condition, features, reason for selling…" placeholderTextColor={MarketColors.muted} />
          <Text style={styles.hint}>{descWords} words</Text>
        </Field>

        {bannedMatches.length > 0 ? (
          <View style={[styles.banner, styles.bannerWarn]}>
            <ShieldAlert size={16} color={MarketColors.danger} />
            <Text style={styles.bannerText}>Please remove disallowed content ({bannedMatches.join(', ')}) before saving.</Text>
          </View>
        ) : null}

        {/* Price */}
        <Field label="Price (₦)" error={showErrors && !priceValid ? 'Enter a price greater than zero.' : null}>
          <TextInput style={styles.input} value={priceInput} onChangeText={setPriceInput} keyboardType="numeric" editable={!terminal} placeholder="0" placeholderTextColor={MarketColors.muted} />
          {priceKobo > 0 ? <Text style={styles.hint}>{formatNaira(priceKobo)}</Text> : null}
        </Field>
        {priceKobo > 0 && band ? <FairPriceMeter priceKobo={priceKobo} band={band} /> : null}

        {/* Category attributes */}
        {schema.fields.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Details</Text>
            <AttributeFields schema={schema} values={attrs} onChange={onChangeAttr} showErrors={showErrors} />
          </View>
        ) : null}

        <View style={{ height: Spacing.lg }} />
        <PrimaryButton label={update.isPending ? 'Saving…' : 'Save changes'} onPress={onSave} disabled={!canSave || terminal} />
        <Pressable style={styles.cancel} onPress={() => goBack('/marketplace/sell')}><Text style={styles.cancelText}>Cancel</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => goBack('/marketplace/sell')} hitSlop={12} accessibilityLabel="Back"><ArrowLeft size={24} color={MarketColors.text} /></Pressable>
      <Text style={styles.headerTitle}>Edit</Text>
      <HomeMenuButton />
    </View>
  );
}

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MarketColors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: MarketColors.border },
  headerTitle: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  body: { padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.lg },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { ...Typography.bodyMd, color: MarketColors.muted },
  h1: { ...Typography.headlineLg, color: MarketColors.text, fontWeight: '800' },
  sub: { ...Typography.bodySm, color: MarketColors.muted, marginTop: -Spacing.sm },
  field: { gap: 6 },
  label: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  input: { ...Typography.bodyMd, color: MarketColors.text, borderWidth: 1, borderColor: MarketColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 12, backgroundColor: MarketColors.surface },
  textarea: { minHeight: 110, textAlignVertical: 'top' },
  hint: { ...Typography.labelSm, color: MarketColors.muted, alignSelf: 'flex-end' },
  errorText: { ...Typography.labelSm, color: MarketColors.danger },
  section: { gap: Spacing.md },
  sectionTitle: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  banner: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1 },
  bannerInfo: { backgroundColor: MarketColors.okBg, borderColor: MarketColors.brand },
  bannerWarn: { backgroundColor: MarketColors.surfaceAlt, borderColor: MarketColors.danger },
  bannerText: { ...Typography.bodySm, color: MarketColors.text, flex: 1 },
  cancel: { alignItems: 'center', paddingVertical: Spacing.md },
  cancelText: { ...Typography.labelMd, color: MarketColors.muted, fontWeight: '600' },
});
