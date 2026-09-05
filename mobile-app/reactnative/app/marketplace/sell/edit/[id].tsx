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
import * as ImagePicker from 'expo-image-picker';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, ShieldAlert, Info } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { MarketColors, formatNaira, conditionLabel } from '@/features/marketplace';
import { estimateFairPriceBand, uploadListingImage } from '@/features/marketplace/api/sell.api';
import {
  useSellListing,
  useSellCategory,
  useUpdateListing,
  useAddListingMedia,
  useRemoveListingMedia,
  useReorderListingMedia,
} from '@/features/marketplace/sell.hooks';
import AttributeFields, { normalizeSchema, missingRequired } from '@/features/marketplace/components/sell/AttributeFields';
import { checkBannedPatterns, countWords } from '@/features/marketplace/components/sell/ComposerValidation';
import FairPriceMeter from '@/features/marketplace/components/sell/FairPriceMeter';
import PhotoStrip, { type ComposerPhoto } from '@/features/marketplace/components/sell/PhotoStrip';
import { HomeMenuButton } from '@/components/HomeMenu';

const MIN_DESC_WORDS = 8;

function phashOf(uri: string): string {
  // Same stand-in as the composer (features/sell/compose.tsx phashOf) — normalized
  // uri for a same-session duplicate hint; the server's DUPLICATE_PHOTO check is
  // authoritative.
  return uri.split('?')[0];
}

export default function EditListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listingQuery = useSellListing(id ?? null);
  const listing = listingQuery.data;
  const categoryQuery = useSellCategory(listing?.categoryId ?? null);
  const update = useUpdateListing();
  const addMedia = useAddListingMedia();
  const removeMedia = useRemoveListingMedia();
  const reorderMedia = useReorderListingMedia();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [attrs, setAttrs] = useState<Record<string, unknown>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Photo management (LM-002) — same capability as the create wizard's
  // PhotoStrip, but against an existing listing: add, remove, reorder.
  const [photos, setPhotos] = useState<ComposerPhoto[]>([]);
  const [originalIds, setOriginalIds] = useState<Set<string>>(new Set());
  const [originalOrder, setOriginalOrder] = useState<string[]>([]);

  // Hydrate the form once, when the listing arrives.
  useEffect(() => {
    if (listing && !hydrated) {
      setTitle(listing.title);
      setDescription(listing.description);
      setPriceInput(String(Math.round(listing.priceKobo / 100)));
      setAttrs({ ...(listing.attrs ?? {}) });
      const media = [...(listing.media ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
      setPhotos(media.map((m) => ({ id: m.id, uri: m.urlCard || m.urlThumb || m.urlFull, phash: m.blurhash || m.id })));
      setOriginalIds(new Set(media.map((m) => m.id)));
      setOriginalOrder(media.map((m) => m.id));
      setHydrated(true);
    }
  }, [listing, hydrated]);

  // ── Photo capture (mirrors sell/compose.tsx addPhotos) ──
  const addPhotos = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (fromCamera) {
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
    const remaining = 10 - photos.length;
    if (remaining <= 0) return;
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true, selectionLimit: remaining });
    if (result.canceled || !result.assets?.length) return;

    const added: ComposerPhoto[] = result.assets.map((a) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      uri: a.uri,
      phash: phashOf(a.uri),
      uploading: true,
    }));
    setPhotos((prev) => [...prev, ...added]);

    for (const p of added) {
      uploadListingImage({ uri: p.uri, name: `${p.id}.jpg`, mimeType: 'image/jpeg' })
        .then((fileUrl) => setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, uploading: false, fileUrl } : x))))
        .catch(() => setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, uploading: false } : x))));
    }
  };

  // Reconciles local photo state against the server: removes dropped photos,
  // appends new ones, then reorders if the final arrangement (which may
  // interleave surviving originals with newly-added photos) doesn't match
  // what remove+append alone would produce.
  async function reconcilePhotos(): Promise<boolean> {
    if (!id) return false;
    if (photos.some((p) => p.uploading)) {
      await alertAsync({ title: 'Photos still uploading', message: 'Give it a second for your photos to finish uploading.' });
      return false;
    }
    const minPhotos = categoryQuery.data?.minPhotos ?? 1;
    if (photos.length < minPhotos) {
      await alertAsync({ title: 'Add more photos', message: `This category needs at least ${minPhotos} photo${minPhotos === 1 ? '' : 's'}.` });
      return false;
    }

    const currentIds = new Set(photos.map((p) => p.id));
    const removedIds = originalOrder.filter((oid) => !currentIds.has(oid));
    const newPhotos = photos.filter((p) => !originalIds.has(p.id));

    for (const rid of removedIds) {
      await removeMedia.mutateAsync({ id, mediaId: rid });
    }

    const idMap = new Map<string, string>();
    if (newPhotos.length > 0) {
      const fileUrls = newPhotos.map((p) => p.fileUrl ?? p.id);
      const updated = await addMedia.mutateAsync({ id, mediaIds: fileUrls });
      const appended = updated.media.slice(updated.media.length - newPhotos.length);
      newPhotos.forEach((p, i) => idMap.set(p.id, appended[i]?.id ?? p.id));
    }

    const remainingOriginalOrder = originalOrder.filter((oid) => currentIds.has(oid));
    const naturalOrder = [...remainingOriginalOrder, ...newPhotos.map((p) => idMap.get(p.id) as string)];
    const desiredOrder = photos.map((p) => idMap.get(p.id) ?? p.id);
    const orderChanged = desiredOrder.length !== naturalOrder.length || desiredOrder.some((v, i) => v !== naturalOrder[i]);

    if (orderChanged && desiredOrder.length > 0) {
      await reorderMedia.mutateAsync({ id, mediaIds: desiredOrder });
    }
    return true;
  }

  const schema = useMemo(() => normalizeSchema(categoryQuery.data?.attributeSchema), [categoryQuery.data]);
  const priceKobo = Math.round((Number(priceInput.replace(/[^0-9.]/g, '')) || 0) * 100);
  const band = useMemo(() => estimateFairPriceBand(listing?.categoryId), [listing?.categoryId]);

  const bannedMatches = useMemo(() => checkBannedPatterns(`${title} ${description}`), [title, description]);
  const descWords = countWords(description);
  const requiredMissing = missingRequired(schema, attrs);
  const titleValid = title.trim().length >= 1 && title.trim().length <= 100;
  const descValid = descWords >= MIN_DESC_WORDS;
  const priceValid = priceKobo > 0;
  const photosValid = photos.length >= (categoryQuery.data?.minPhotos ?? 1) && !photos.some((p) => p.uploading);
  const savingPhotos = addMedia.isPending || removeMedia.isPending || reorderMedia.isPending;
  const canSave = hydrated && titleValid && descValid && priceValid && photosValid && bannedMatches.length === 0 && requiredMissing.length === 0 && !update.isPending && !savingPhotos;

  // Adding or removing a photo re-moderates an active listing on the backend
  // (remoderatePhotosEdit), same as a title/description/attrs edit — a pure
  // reorder does not.
  const photosAddedOrRemoved = useMemo(() => {
    if (!hydrated) return false;
    const currentIds = new Set(photos.map((p) => p.id));
    const removed = originalOrder.some((oid) => !currentIds.has(oid));
    const added = photos.some((p) => !originalIds.has(p.id));
    return removed || added;
  }, [photos, originalOrder, originalIds, hydrated]);

  // Whether this save changes moderation-relevant content (→ re-review if live).
  const contentChanged = useMemo(() => {
    if (!listing) return false;
    return (
      title.trim() !== listing.title.trim() ||
      description.trim() !== listing.description.trim() ||
      JSON.stringify(attrs) !== JSON.stringify(listing.attrs ?? {}) ||
      photosAddedOrRemoved
    );
  }, [listing, title, description, attrs, photosAddedOrRemoved]);
  const willReReview = !!listing && listing.status === 'active' && contentChanged;

  function onChangeAttr(key: string, value: unknown) {
    setAttrs((prev) => ({ ...prev, [key]: value }));
  }

  async function onSave() {
    setShowErrors(true);
    if (!canSave || !id) return;
    try {
      const photosOk = await reconcilePhotos();
      if (!photosOk) return;
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

        {/* Photos */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <PhotoStrip
            photos={photos}
            onReorder={terminal ? () => {} : setPhotos}
            onRemove={terminal ? () => {} : (pid) => setPhotos((prev) => prev.filter((p) => p.id !== pid))}
            onAddCamera={terminal ? () => {} : () => addPhotos(true)}
            onAddGallery={terminal ? () => {} : () => addPhotos(false)}
            maxPhotos={terminal ? photos.length : 10}
          />
          {showErrors && photos.length < (categoryQuery.data?.minPhotos ?? 1) ? (
            <Text style={styles.errorText}>This category needs at least {categoryQuery.data?.minPhotos ?? 1} photo{(categoryQuery.data?.minPhotos ?? 1) === 1 ? '' : 's'}.</Text>
          ) : null}
        </View>

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
        <PrimaryButton label={update.isPending || savingPhotos ? 'Saving…' : 'Save changes'} onPress={onSave} disabled={!canSave || terminal} />
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
