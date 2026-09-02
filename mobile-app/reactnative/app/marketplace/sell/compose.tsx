// ── Sell wizard — screens 10–14 in one route (camera → publish) ──────────────
//
// Hosted as a single Expo Router route (`marketplace/sell/compose`, already
// registered href:null in the marketplace tabs layout) that walks a five-step
// draft flow with internal step state, so no new tab-level routes are added:
//   10 capture   — camera-first (expo-image-picker), gallery fallback on denial
//   11 composer  — reorderable photos, AI-prefilled editable suggestions,
//                  real-time validation (words / banned-patterns / duplicates)
//   12 attributes— dynamic form from the category attribute schema
//   13 price     — live fair-price band, escrow toggle, delivery options
//   14 preview   — Listing-Detail-style preview → Publish (create → submit)
//
// Publish = POST /listings (draft) then POST /listings/:id/submit. Success shows
// "live in <5 min" for auto-approved categories, then routes to My Listings.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Image, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
// Aliased: this screen already has a local `goBack` that steps back through
// the wizard. Without the alias my call sites resolved to THAT function and
// recursed into it with an argument it does not take.
import { goBack as leaveScreen } from '@/lib/navigation';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, Camera, ImagePlus, CheckCircle2, ShieldCheck, Truck, MapPin, Handshake } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { sanitizeMoneyInput } from '@/utils/money';
import {
  MarketColors,
  formatNaira,
  conditionLabel,
} from '@/features/marketplace';
import type { ListingCondition, DeliveryOption } from '@/features/marketplace';
import { aiPrefill, estimateFairPriceBand, uploadListingImage, isEscrowEligibleCategory } from '@/features/marketplace/api/sell.api';
import type { AiPrefillResult } from '@/features/marketplace/api/sell.api';
import { useSellCategories, useSellCategory, useCreateListing, useSubmitListing } from '@/features/marketplace/sell.hooks';
import { mainCategories, subcategoriesOf } from '@/features/marketplace/categoryTree';
import PhotoStrip, { type ComposerPhoto } from '@/features/marketplace/components/sell/PhotoStrip';
import AiPrefillCard from '@/features/marketplace/components/sell/AiPrefillCard';
import ComposerValidation, { checkBannedPatterns, countWords } from '@/features/marketplace/components/sell/ComposerValidation';
import AttributeFields, { normalizeSchema, missingRequired } from '@/features/marketplace/components/sell/AttributeFields';
import FairPriceMeter from '@/features/marketplace/components/sell/FairPriceMeter';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import { HomeMenuButton } from '@/components/HomeMenu';

function track(event: string, props: Record<string, unknown>) {
  if (__DEV__) console.log(`[analytics] ${event}`, props);
}

type Step = 'capture' | 'composer' | 'attributes' | 'price' | 'preview';
const CONDITIONS: ListingCondition[] = ['new', 'foreign_used', 'local_used', 'used', 'refurbished'];
const DELIVERY_OPTIONS: Array<{ key: DeliveryOption | 'seller_arranged'; label: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = [
  { key: 'pickup', label: 'Pickup', icon: MapPin },
  { key: 'rider_delivery', label: 'Paymax logistics', icon: Truck },
  { key: 'seller_arranged', label: 'Seller-arranged', icon: Handshake },
];

function phashOf(uri: string): string {
  // Client-side duplicate-detection stand-in: a true perceptual hash needs native
  // image processing. Comparing normalized uris catches an obvious double-pick
  // within a session; the server's DUPLICATE_PHOTO check is authoritative.
  return uri.split('?')[0];
}

export default function SellWizard() {
  const [step, setStep] = useState<Step>('capture');

  // ── Draft state ──
  const [photos, setPhotos] = useState<ComposerPhoto[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState<ListingCondition>('used');
  const [attrs, setAttrs] = useState<Record<string, unknown>>({});
  const [attrsTouched, setAttrsTouched] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [escrowReady, setEscrowReady] = useState(true);
  const [delivery, setDelivery] = useState<Set<string>>(new Set(['pickup']));

  // ── AI prefill ──
  const [aiResult, setAiResult] = useState<AiPrefillResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDismissed, setAiDismissed] = useState(false);

  const categoriesQuery = useSellCategories();
  // Two-step picker. One flat row of every category was 84 chips deep once the
  // taxonomy gained subcategories, and — worse — it let a seller file a listing
  // against a MAIN category. Nothing lives in a main: browsing one searches its
  // descendants, so a listing parked on the main itself would be invisible in
  // every subcategory and turn up only on the main's own page.
  const [mainId, setMainId] = useState('');
  const mains = mainCategories(categoriesQuery.data);
  const subs = subcategoriesOf(categoriesQuery.data, mainId);
  const categoryQuery = useSellCategory(categoryId);
  const createListing = useCreateListing();
  const submitListing = useSubmitListing();

  const category = categoriesQuery.data?.find((c) => c.id === categoryId);
  const minPhotos = category?.minPhotos ?? 3;
  const minWords = category?.minDescriptionWords ?? 8;
  const schema = useMemo(() => normalizeSchema(categoryQuery.data?.attributeSchema), [categoryQuery.data]);
  const priceKobo = Math.round((Number(priceInput.replace(/[^0-9.]/g, '')) || 0) * 100);
  // Prefer a server band if the category read-model carries one; else a client estimate.
  const band = useMemo(() => {
    const serverBand = (categoryQuery.data as { fairPriceBand?: import('@/features/marketplace').FairPriceBand } | undefined)?.fairPriceBand;
    return serverBand ?? estimateFairPriceBand(categoryId);
  }, [categoryId, categoryQuery.data]);

  // Default the escrow toggle from category eligibility whenever the category changes.
  useEffect(() => {
    if (categoryId) setEscrowReady(isEscrowEligibleCategory(categoryId));
  }, [categoryId]);

  // ── Live validation (composer step) ──
  const bannedMatches = useMemo(() => checkBannedPatterns(`${title} ${description}`), [title, description]);
  const wordCount = countWords(description);
  const hasDuplicatePhoto = useMemo(() => {
    const seen = new Set<string>();
    for (const p of photos) {
      if (seen.has(p.phash)) return true;
      seen.add(p.phash);
    }
    return false;
  }, [photos]);

  const composerValid =
    photos.length >= minPhotos &&
    wordCount >= minWords &&
    bannedMatches.length === 0 &&
    !hasDuplicatePhoto &&
    title.trim().length >= 1 &&
    !!categoryId;

  const requiredMissing = missingRequired(schema, attrs);
  const attributesValid = requiredMissing.length === 0;
  const priceValid = priceKobo > 0;

  // ── Photo capture (step 10) ──
  const addPhotos = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (fromCamera) {
        // Camera denied → gallery fallback (spec §10).
        const ok = await confirmAsync({
          title: 'Camera unavailable',
          message: "We couldn't open the camera. Pick photos from your gallery instead.",
          confirmLabel: 'Open gallery',
        });
        if (ok) addPhotos(false);
      } else {
        alertAsync({ title: 'Permission needed', message: 'Allow photo access to add listing photos.' });
      }
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true, selectionLimit: 10 });
    if (result.canceled || !result.assets?.length) return;

    const startedEmpty = photos.length === 0;
    const added: ComposerPhoto[] = result.assets.map((a) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      uri: a.uri,
      phash: phashOf(a.uri),
      uploading: true,
    }));
    setPhotos((prev) => [...prev, ...added]);
    track('composer_photo_captured', { count: added.length, via: fromCamera ? 'camera' : 'gallery' });

    // Advance from the capture screen into the composer once we have photos.
    if (startedEmpty) {
      setStep('composer');
      void runAiPrefill(added[0]);
    }

    // Upload each picked photo (presign → PUT). Non-blocking; the composer works
    // while uploads run, and Publish waits for fileUrls.
    for (const p of added) {
      uploadListingImage({ uri: p.uri, name: `${p.id}.jpg`, mimeType: 'image/jpeg' })
        .then((fileUrl) => setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, uploading: false, fileUrl } : x))))
        .catch(() => setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, uploading: false } : x))));
    }
  };

  const runAiPrefill = async (firstPhoto: ComposerPhoto) => {
    setAiLoading(true);
    try {
      const res = await aiPrefill(firstPhoto.uri);
      setAiResult(res);
      track('ai_prefill_shown', { confidence: res.confidence, category_id: res.categoryId });
    } catch {
      // Graceful degradation — no card, blank form (spec §11).
      setAiResult(null);
      setAiDismissed(true);
      track('ai_prefill_failed', {});
    } finally {
      setAiLoading(false);
    }
  };

  const acceptAi = () => {
    if (!aiResult) return;
    if (aiResult.categoryId) setCategoryId(aiResult.categoryId);
    if (aiResult.suggestedTitle && !title) setTitle(aiResult.suggestedTitle);
    if (aiResult.suggestedCondition) setCondition(aiResult.suggestedCondition);
    if (aiResult.suggestedAttrs) setAttrs((prev) => ({ ...aiResult.suggestedAttrs, ...prev }));
    setAiDismissed(true);
    track('ai_prefill_accepted', {});
  };

  // ── Publish (step 14) ──
  const handlePublish = async () => {
    if (!categoryId) return;
    const pendingUploads = photos.some((p) => p.uploading);
    if (pendingUploads) {
      alertAsync({ title: 'Photos still uploading', message: 'Give it a second for your photos to finish uploading.' });
      return;
    }
    try {
      const created = await createListing.mutateAsync({
        categoryId,
        title: title.trim(),
        description: description.trim(),
        priceKobo,
        condition,
        attrs,
        mediaIds: photos.map((p) => p.fileUrl ?? p.id),
        state: 'Lagos',
        escrowEligible: escrowReady,
      });
      const live = await submitListing.mutateAsync(created.id);
      track('listing_published', { listing_id: created.id, category_id: categoryId, status: live.status, escrow: escrowReady });
      const autoApproved = live.status === 'active';
      await alertAsync({
        title: autoApproved ? "You're live!" : 'Submitted for review',
        message: autoApproved
          ? 'Your listing is live and searchable — usually within 5 minutes for this category.'
          : "Thanks! We're reviewing your listing and will notify you shortly.",
        buttonLabel: 'View my listings',
      });
      router.replace('/marketplace/sell' as never);
    } catch (e) {
      alertAsync({ title: 'Could not publish', message: (e as Error).message || 'Please try again.' });
    }
  };

  const goBack = () => {
    const order: Step[] = ['capture', 'composer', 'attributes', 'price', 'preview'];
    const i = order.indexOf(step);
    if (i <= 0) { leaveScreen('/marketplace/sell'); return; }
    setStep(order[i - 1]);
  };

  const publishing = createListing.isPending || submitListing.isPending;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{HEADER_TITLE[step]}</Text>
        <HomeMenuButton />
      </View>
      <StepBar step={step} />

      {step === 'capture' ? (
        <CaptureScreen onCamera={() => addPhotos(true)} onGallery={() => addPhotos(false)} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {step === 'composer' ? (
            <>
              <PhotoStrip
                photos={photos}
                onReorder={setPhotos}
                onRemove={(id) => setPhotos((prev) => prev.filter((p) => p.id !== id))}
                onAddCamera={() => addPhotos(true)}
                onAddGallery={() => addPhotos(false)}
              />

              {(aiLoading || (aiResult && !aiDismissed)) ? (
                <AiPrefillCard loading={aiLoading} result={aiResult} onAccept={acceptAi} onDismiss={() => setAiDismissed(true)} />
              ) : null}

              <Text style={styles.label}>Title</Text>
              <TextInput style={styles.input} placeholder="e.g. iPhone 13 Pro Max — 256GB" placeholderTextColor={MarketColors.muted} value={title} onChangeText={setTitle} maxLength={100} />

              <Text style={styles.label}>Category</Text>
              <View style={styles.chipRow}>
                {mains.map((c) => {
                  const children = subcategoriesOf(categoriesQuery.data, c.id);
                  const selected = mainId === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      style={[styles.chip, selected && styles.chipActive]}
                      onPress={() => {
                        setMainId(c.id);
                        // A main with no children IS the leaf, so it is a valid
                        // choice; one with children is only a step on the way.
                        setCategoryId(children.length === 0 ? c.id : '');
                      }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{c.name}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {subs.length > 0 ? (
                <>
                  <Text style={styles.label}>Subcategory</Text>
                  <View style={styles.chipRow}>
                    {subs.map((c) => (
                      <Pressable key={c.id} style={[styles.chip, categoryId === c.id && styles.chipActive]} onPress={() => setCategoryId(c.id)}>
                        <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={styles.label}>Condition</Text>
              <View style={styles.chipRow}>
                {CONDITIONS.map((c) => (
                  <Pressable key={c} style={[styles.chip, condition === c && styles.chipActive]} onPress={() => setCondition(c)}>
                    <Text style={[styles.chipText, condition === c && styles.chipTextActive]}>{conditionLabel(c)}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder="Describe condition, accessories, reason for selling…"
                placeholderTextColor={MarketColors.muted}
                value={description}
                onChangeText={setDescription}
                multiline
              />

              <ComposerValidation
                state={{ wordCount, minWords, photoCount: photos.length, minPhotos, hasDuplicatePhoto, bannedMatches }}
              />
            </>
          ) : null}

          {step === 'attributes' ? (
            <>
              <Text style={styles.sectionHint}>{category?.name} details — help buyers filter and find your item.</Text>
              <AttributeFields schema={schema} values={attrs} onChange={(k, v) => setAttrs((prev) => ({ ...prev, [k]: v }))} showErrors={attrsTouched} />
            </>
          ) : null}

          {step === 'price' ? (
            <>
              <Text style={styles.label}>Price (₦)</Text>
              <TextInput style={styles.input} placeholder="0" placeholderTextColor={MarketColors.muted} value={priceInput} onChangeText={(v) => setPriceInput(sanitizeMoneyInput(v))} keyboardType="decimal-pad" inputMode="decimal" maxLength={13} />
              <View style={{ height: Spacing.sm }} />
              <FairPriceMeter priceKobo={priceKobo} band={band} />

              <View style={styles.escrowRow}>
                <View style={styles.escrowText}>
                  <View style={styles.escrowTitleRow}>
                    <ShieldCheck size={18} color={MarketColors.ok} />
                    <Text style={styles.escrowTitle}>Escrow-ready</Text>
                  </View>
                  <Text style={styles.escrowSub}>Buyers pay into Paymax escrow — safer for both sides and boosts conversions.</Text>
                </View>
                <Switch value={escrowReady} onValueChange={setEscrowReady} trackColor={{ true: MarketColors.ok }} />
              </View>

              <Text style={styles.label}>Delivery options</Text>
              <View style={styles.chipRow}>
                {DELIVERY_OPTIONS.map(({ key, label, icon: Icon }) => {
                  const active = delivery.has(key);
                  return (
                    <Pressable
                      key={key}
                      style={[styles.deliveryChip, active && styles.chipActive]}
                      onPress={() =>
                        setDelivery((prev) => {
                          const next = new Set(prev);
                          next.has(key) ? next.delete(key) : next.add(key);
                          if (next.size === 0) next.add('pickup');
                          return next;
                        })
                      }
                    >
                      <Icon size={16} color={active ? MarketColors.brand : MarketColors.muted} />
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {step === 'preview' ? (
            <ListingPreview
              photos={photos}
              title={title}
              categoryName={category?.name ?? ''}
              condition={condition}
              priceKobo={priceKobo}
              description={description}
              attrs={attrs}
              schema={schema}
              escrowReady={escrowReady}
              delivery={Array.from(delivery)}
            />
          ) : null}

          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {step !== 'capture' ? (
        <View style={styles.footer}>
          {step === 'composer' ? (
            <PrimaryButton label="Next: details" onPress={() => setStep('attributes')} disabled={!composerValid} />
          ) : step === 'attributes' ? (
            <PrimaryButton label="Next: price" onPress={() => { setAttrsTouched(true); if (attributesValid) setStep('price'); }} disabled={!attributesValid && attrsTouched} />
          ) : step === 'price' ? (
            <PrimaryButton label="Preview listing" onPress={() => setStep('preview')} disabled={!priceValid} />
          ) : (
            <PrimaryButton label="Publish" onPress={handlePublish} loading={publishing} disabled={publishing} />
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const HEADER_TITLE: Record<Step, string> = {
  capture: 'Add photos',
  composer: 'New listing',
  attributes: 'Item details',
  price: 'Set your price',
  preview: 'Preview & publish',
};

function StepBar({ step }: { step: Step }) {
  const order: Step[] = ['capture', 'composer', 'attributes', 'price', 'preview'];
  const active = order.indexOf(step);
  return (
    <View style={styles.stepBar}>
      {order.map((s, i) => (
        <View key={s} style={[styles.stepSeg, i <= active && styles.stepSegActive]} />
      ))}
    </View>
  );
}

// ── Screen 10 — camera-first capture ──
function CaptureScreen({ onCamera, onGallery }: { onCamera: () => void; onGallery: () => void }) {
  return (
    <View style={styles.capture}>
      <View style={styles.captureIcon}><Camera size={40} color={MarketColors.brand} /></View>
      <Text style={styles.captureTitle}>Snap your item</Text>
      <Text style={styles.captureBody}>Good photos sell faster. Take a few from different angles — our composer fills in the rest.</Text>
      <View style={styles.captureCtas}>
        <PrimaryButton label="Open camera" onPress={onCamera} />
        <Pressable style={styles.galleryBtn} onPress={onGallery} accessibilityRole="button">
          <ImagePlus size={18} color={MarketColors.brand} />
          <Text style={styles.galleryText}>Choose from gallery</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Screen 14 — Listing-Detail-style preview ──
function ListingPreview(props: {
  photos: ComposerPhoto[];
  title: string;
  categoryName: string;
  condition: ListingCondition;
  priceKobo: number;
  description: string;
  attrs: Record<string, unknown>;
  schema: ReturnType<typeof normalizeSchema>;
  escrowReady: boolean;
  delivery: string[];
}) {
  const { photos, title, categoryName, condition, priceKobo, description, attrs, schema, escrowReady } = props;
  const cover = photos[0];
  const attrRows = schema.fields
    .map((f) => ({ label: f.label, value: attrs[f.key] }))
    .filter((r) => r.value !== undefined && r.value !== null && String(r.value).trim() !== '');

  return (
    <View style={styles.previewWrap}>
      <View style={styles.previewGallery}>
        {cover ? <Image source={{ uri: cover.uri }} style={styles.previewImage} /> : <View style={styles.previewImage} />}
        {photos.length > 1 ? <View style={styles.galleryCount}><Text style={styles.galleryCountText}>1 / {photos.length}</Text></View> : null}
      </View>
      <Text style={styles.previewPrice}>{formatNaira(priceKobo)}</Text>
      <Text style={styles.previewTitle}>{title || 'Untitled listing'}</Text>
      <View style={styles.previewMetaRow}>
        <Text style={styles.previewMeta}>{categoryName}</Text>
        <Text style={styles.previewDot}>·</Text>
        <Text style={styles.previewMeta}>{conditionLabel(condition)}</Text>
      </View>

      {escrowReady ? (
        <View style={styles.escrowStrip}>
          <ShieldCheck size={16} color={MarketColors.ok} />
          <Text style={styles.escrowStripText}>Buyer-protected with Paymax escrow.</Text>
        </View>
      ) : null}

      {attrRows.length > 0 ? (
        <View style={styles.attrTable}>
          {attrRows.map((r) => (
            <View key={r.label} style={styles.attrTableRow}>
              <Text style={styles.attrKey}>{r.label}</Text>
              <Text style={styles.attrVal}>{String(r.value)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.previewSection}>Description</Text>
      <Text style={styles.previewDesc}>{description || '—'}</Text>

      <View style={styles.previewNote}>
        <CheckCircle2 size={16} color={MarketColors.brand} />
        <Text style={styles.previewNoteText}>This is exactly how buyers will see your listing.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1, textAlign: 'center' },
  stepBar: { flexDirection: 'row', gap: 4, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  stepSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: MarketColors.surfaceAlt },
  stepSegActive: { backgroundColor: MarketColors.brand },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs, gap: Spacing.xs },
  label: { ...Typography.labelLg, color: MarketColors.text, marginTop: Spacing.md, marginBottom: 4, fontWeight: '700' },
  sectionHint: { ...Typography.bodyMd, color: MarketColors.muted, marginBottom: Spacing.sm },
  input: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: MarketColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 14, backgroundColor: MarketColors.surface },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface },
  deliveryChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface },
  chipActive: { borderColor: MarketColors.brand, backgroundColor: MarketColors.okBg },
  chipText: { ...Typography.labelMd, color: MarketColors.muted },
  chipTextActive: { color: MarketColors.brand, fontWeight: '700' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
  // capture
  capture: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  captureIcon: { width: 88, height: 88, borderRadius: 24, backgroundColor: MarketColors.okBg, alignItems: 'center', justifyContent: 'center' },
  captureTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  captureBody: { ...Typography.bodyMd, color: MarketColors.muted, textAlign: 'center' },
  captureCtas: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.sm },
  galleryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  galleryText: { ...Typography.labelLg, color: MarketColors.brand, fontWeight: '700' },
  // escrow toggle row
  escrowRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.lg, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: MarketColors.surface, borderWidth: 1, borderColor: MarketColors.border },
  escrowText: { flex: 1, gap: 4 },
  escrowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  escrowTitle: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  escrowSub: { ...Typography.labelSm, color: MarketColors.muted },
  // preview
  previewWrap: { gap: Spacing.sm, paddingTop: Spacing.sm },
  previewGallery: { height: 240, borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: MarketColors.surfaceAlt },
  previewImage: { width: '100%', height: '100%' },
  galleryCount: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(11,28,48,0.7)', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  galleryCountText: { ...Typography.labelSm, color: '#FFFFFF' },
  previewPrice: { ...Typography.headlineMd, color: MarketColors.brand, marginTop: Spacing.sm },
  previewTitle: { ...Typography.titleLg, color: MarketColors.text },
  previewMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewMeta: { ...Typography.labelMd, color: MarketColors.muted },
  previewDot: { color: MarketColors.muted },
  escrowStrip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: MarketColors.okBg, borderRadius: Radius.md, padding: Spacing.sm, marginTop: 4 },
  escrowStripText: { ...Typography.labelSm, color: MarketColors.ok, fontWeight: '600' },
  attrTable: { borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, overflow: 'hidden', marginTop: Spacing.sm },
  attrTableRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: MarketColors.border },
  attrKey: { ...Typography.labelMd, color: MarketColors.muted },
  attrVal: { ...Typography.labelMd, color: MarketColors.text, fontWeight: '600' },
  previewSection: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700', marginTop: Spacing.md },
  previewDesc: { ...Typography.bodyMd, color: MarketColors.text },
  previewNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md },
  previewNoteText: { ...Typography.labelSm, color: MarketColors.muted },
});
