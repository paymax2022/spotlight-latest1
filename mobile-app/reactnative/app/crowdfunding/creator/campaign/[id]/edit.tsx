import React, { useMemo, useState } from 'react';
import {
  ScrollView, View, Text, Image, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ImagePlus, TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import { goBack } from '@/lib/navigation';
import { confirmAsync } from '@/lib/confirm';
import { getErrorMessage } from '@/utils/errorMapper';
import { sanitizeMoneyInput, nairaStringToKobo } from '@/utils/money';
import { useMyCampaign, useUpdateCampaign } from '@/features/crowdfunding/hooks/useCreator';
import { CAMPAIGN_CATEGORIES } from '@/features/crowdfunding/constants/crowdfunding.constants';
import { pickFromLibrary } from '@/features/crowdfunding/utils/mediaPicker';
import { uploadCampaignCover } from '@/features/crowdfunding/api/coverUpload';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import { canEdit } from '@/features/crowdfunding/utils/ownerCampaignActions';
import type { CampaignEditInput } from '@/features/crowdfunding/types/crowdfunding.types';

/**
 * Edit a campaign the owner owns.
 *
 * The PATCH contract is subset-semantic — an absent key is left unchanged — so
 * this screen sends ONLY the fields whose value actually differs from what the
 * server last returned. Posting the whole form back would silently rewrite
 * fields the owner never opened with whatever the local copy happened to hold.
 *
 * The cover image is uploaded at pick time, exactly as the creation wizard
 * does: the picker URI is `blob:` on web and `file://` on native, and neither
 * resolves anywhere else, so only the uploaded https URL is ever sent.
 */
export default function EditCampaignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { campaign, isLoading, isError, refetch } = useMyCampaign(id);
  const update = useUpdateCampaign(id);

  const [form, setForm] = useState<{
    title: string; summary: string; story: string; category: string;
    coverImage: string | null; goalText: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);

  const categoryLabels = useMemo(() => CAMPAIGN_CATEGORIES.map((c) => c.label), []);

  // Seed the form from the server copy exactly once, then leave it alone: a
  // background refetch must not overwrite what the owner is typing.
  if (campaign && form === null) {
    setForm({
      title: campaign.title,
      summary: campaign.summary,
      story: campaign.story,
      category: campaign.category,
      coverImage: campaign.coverImage,
      goalText: String(Math.round(campaign.goalKobo / 100)),
    });
  }

  if (isLoading || (campaign && !form)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Edit campaign" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (isError || !campaign || !form) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Edit campaign" />
        <StateView
          kind={isError ? 'error' : 'empty'}
          icon="Megaphone"
          title={isError ? "Couldn't load this campaign" : 'Campaign not found'}
          actionLabel={isError ? 'Retry' : 'Back'}
          onAction={isError ? refetch : () => goBack('/crowdfunding/creator/campaigns')}
        />
      </SafeAreaView>
    );
  }

  const gate = canEdit(campaign);
  if (!gate.allowed) {
    // Reachable by deep link even though the manage screen gates the entry —
    // refuse here too rather than letting a save become a guaranteed refusal.
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Edit campaign" />
        <StateView
          kind="empty"
          icon="Lock"
          title="This campaign can't be edited"
          message={gate.reason}
          actionLabel="Back"
          onAction={() => goBack(`/crowdfunding/creator/campaign/${campaign.id}`)}
        />
      </SafeAreaView>
    );
  }

  const set = <K extends keyof NonNullable<typeof form>>(key: K, value: NonNullable<typeof form>[K]) => {
    // Any further edit retires the "saved" banner: it must only ever describe
    // a write the server has already acknowledged.
    setSaved(false);
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  const goalKobo = nairaStringToKobo(form.goalText);
  const goalTooLow = goalKobo < 100_000;                       // ₦1,000 floor
  const goalBelowRaised = goalKobo < campaign.raisedKobo;
  const titleInvalid = form.title.trim().length < 5;
  const summaryInvalid = form.summary.trim().length < 10;

  /** Only the keys that genuinely changed — subset semantics on the wire. */
  const patch: CampaignEditInput = {};
  if (form.title.trim() !== campaign.title) patch.title = form.title.trim();
  if (form.summary.trim() !== campaign.summary) patch.summary = form.summary.trim();
  if (form.story.trim() !== campaign.story) patch.story = form.story.trim();
  if (form.category !== campaign.category) patch.category = form.category;
  if (form.coverImage !== campaign.coverImage) patch.coverImage = form.coverImage;
  if (goalKobo !== campaign.goalKobo) patch.goalKobo = goalKobo;

  const changedCount = Object.keys(patch).length;
  const invalid = titleInvalid || summaryInvalid || goalTooLow || goalBelowRaised;

  const pickCover = async () => {
    const asset = await pickFromLibrary({ kind: 'images', allowsEditing: true, aspect: [16, 9] });
    if (!asset) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadCampaignCover(asset.uri);
      set('coverImage', url);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const onSave = async () => {
    if (invalid || changedCount === 0) return;
    // Lowering a public goal changes what every existing backer was told, so it
    // gets an explicit confirmation rather than slipping through with the rest.
    if (patch.goalKobo !== undefined && patch.goalKobo < campaign.goalKobo) {
      const ok = await confirmAsync({
        title: 'Lower the funding goal?',
        message: `The goal drops from ${formatNaira(campaign.goalKobo)} to ${formatNaira(patch.goalKobo)}. Everyone who has already backed this campaign sees the new goal and progress.`,
        confirmLabel: 'Change goal',
      });
      if (!ok) return;
    }
    setError(null);
    setSaved(false);
    try {
      // Reseed from the campaign the SERVER returned, not from local state —
      // if it normalised or rejected part of the patch, the form shows what was
      // actually stored instead of claiming the edit landed as typed.
      const updated = await update.mutateAsync(patch);
      setForm({
        title: updated.title,
        summary: updated.summary,
        story: updated.story,
        category: updated.category,
        coverImage: updated.coverImage,
        goalText: String(Math.round(updated.goalKobo / 100)),
      });
      setSaved(true);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Edit campaign"
        subtitle={campaign.title}
        onBack={() => goBack(`/crowdfunding/creator/campaign/${campaign.id}`)}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {error ? (
            <View style={[styles.banner, styles.bannerError]}>
              <TriangleAlert size={16} color={Colors.error} strokeWidth={2} />
              <Text style={styles.bannerText} role="alert">{error}</Text>
            </View>
          ) : null}
          {saved ? (
            <View style={[styles.banner, styles.bannerOk]}>
              <Text style={styles.bannerText}>Saved. Your campaign now shows these details.</Text>
            </View>
          ) : null}

          <Text style={styles.label}>Cover image</Text>
          <Pressable style={styles.cover} onPress={pickCover} disabled={uploading} accessibilityRole="button" accessibilityLabel="Change cover image">
            {uploading ? (
              <ActivityIndicator color={Colors.primary} />
            ) : form.coverImage ? (
              <Image source={{ uri: form.coverImage }} style={styles.coverImg} resizeMode="cover" />
            ) : (
              <View style={styles.coverEmpty}>
                <ImagePlus size={22} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.coverEmptyText}>Choose a cover image</Text>
              </View>
            )}
          </Pressable>
          {form.coverImage && !uploading ? (
            <Pressable onPress={() => set('coverImage', null)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.removeCover}>Remove cover image</Text>
            </Pressable>
          ) : null}

          <TextInputField
            label="Title"
            value={form.title}
            onChangeText={(t) => set('title', t)}
            maxLength={120}
            error={titleInvalid ? 'Give your campaign a title of at least 5 characters.' : undefined}
          />

          <TextInputField
            label="Short summary"
            value={form.summary}
            onChangeText={(t) => set('summary', t)}
            multiline
            numberOfLines={3}
            maxLength={200}
            error={summaryInvalid ? 'Write a summary of at least 10 characters.' : undefined}
          />

          <SelectField
            label="Category"
            value={CAMPAIGN_CATEGORIES.find((c) => c.slug === form.category)?.label}
            options={categoryLabels}
            onChange={(label) => {
              const slug = CAMPAIGN_CATEGORIES.find((c) => c.label === label)?.slug;
              if (slug) set('category', slug);
            }}
            searchable
          />

          <Text style={styles.label}>Funding goal</Text>
          <View style={styles.amountWrap}>
            <Text style={styles.naira}>₦</Text>
            <TextInputField
              style={styles.amountInput}
              value={form.goalText}
              onChangeText={(t) => set('goalText', sanitizeMoneyInput(t))}
              keyboardType="decimal-pad"
              maxLength={13}
              placeholder="0"
            />
          </View>
          {goalBelowRaised ? (
            <Text style={styles.err}>
              The goal cannot be below the {formatNaira(campaign.raisedKobo)} already raised.
            </Text>
          ) : goalTooLow ? (
            <Text style={styles.err}>The minimum funding goal is ₦1,000.</Text>
          ) : (
            <Text style={styles.hint}>{formatNaira(campaign.raisedKobo)} raised so far.</Text>
          )}

          <TextInputField
            label="Full story"
            value={form.story}
            onChangeText={(t) => set('story', t)}
            multiline
            numberOfLines={8}
            style={styles.story}
          />
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton
            label={changedCount === 0 ? 'No changes to save' : `Save ${changedCount} change${changedCount === 1 ? '' : 's'}`}
            onPress={onSave}
            disabled={invalid || changedCount === 0 || uploading}
            loading={update.isPending}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },

  banner: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  bannerError: { backgroundColor: Colors.errorContainer },
  bannerOk: { backgroundColor: Colors.iconBgTeal },
  bannerText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },

  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 6 },
  err: { ...Typography.labelSm, color: Colors.error, marginTop: 6 },

  cover: { height: 160, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverImg: { width: '100%', height: '100%' },
  coverEmpty: { alignItems: 'center', gap: 6 },
  coverEmptyText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  removeCover: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs, marginBottom: Spacing.md },

  amountWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  naira: { ...Typography.titleLg, color: Colors.onSurfaceVariant },
  amountInput: { flex: 1 },
  story: { minHeight: 160 },

  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
