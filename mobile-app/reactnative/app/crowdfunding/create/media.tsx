import React, { useState } from 'react';
import { ScrollView, View, Text, Image, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ImagePlus, Plus, X, Video, Camera, Images } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import WizardHeader from '@/features/crowdfunding/components/WizardHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignDraft } from '@/features/crowdfunding/store/campaignDraftStore';
import { pickFromLibrary, pickMultipleFromLibrary, takePhoto } from '@/features/crowdfunding/utils/mediaPicker';
import { uploadCampaignCover } from '@/features/crowdfunding/api/coverUpload';
import { getErrorMessage } from '@/utils/errorMapper';

export default function CreateMediaScreen() {
  const { draft, patch } = useCampaignDraft();
  const [uploading, setUploading] = useState(false);
  const [coverError, setCoverError] = useState('');

  /**
   * Upload immediately, then store the RETURNED URL rather than the picker URI.
   * The picker URI is blob: on web and file:// on native; neither survives to the
   * server, and the submit payload drops any cover that is not already http(s) —
   * which is why chosen covers never appeared.
   *
   * On failure the draft keeps no cover, so "Continue" stays disabled and the
   * problem is visible here rather than as a missing image days later.
   */
  const acceptCover = async (uri: string) => {
    setUploading(true);
    setCoverError('');
    try {
      const { url } = await uploadCampaignCover(uri);
      patch({ coverImageUri: url });
    } catch (err) {
      setCoverError(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const pickCover = async () => {
    const asset = await pickFromLibrary({ kind: 'images', allowsEditing: true, aspect: [16, 9] });
    if (asset) await acceptCover(asset.uri);
  };
  const shootCover = async () => {
    const asset = await takePhoto({ allowsEditing: true, aspect: [16, 9] });
    if (asset) await acceptCover(asset.uri);
  };
  const addGallery = async () => {
    const remaining = 6 - draft.galleryUris.length;
    if (remaining <= 0) return;
    const assets = await pickMultipleFromLibrary(remaining);
    if (assets.length) patch({ galleryUris: [...draft.galleryUris, ...assets.map((a) => a.uri)] });
  };
  const removeGallery = (uri: string) => patch({ galleryUris: draft.galleryUris.filter((u) => u !== uri) });
  const pickVideo = async () => {
    const asset = await pickFromLibrary({ kind: 'videos', allowsEditing: false });
    if (asset) patch({ videoUri: asset.uri });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WizardHeader step={5} totalSteps={9} title="Add photos & video" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.label}>Cover image</Text>
        <Text style={styles.hint}>This is the first thing supporters see. Use a clear, genuine photo.</Text>
        {coverError ? <Text style={styles.coverError} role="alert">{coverError}</Text> : null}

        {uploading ? (
          <View style={[styles.coverWrap, styles.coverBusy]}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.coverBusyText}>Uploading cover…</Text>
          </View>
        ) : draft.coverImageUri ? (
          <View style={styles.coverWrap}>
            <Image source={{ uri: draft.coverImageUri }} style={styles.cover} resizeMode="cover" />
            <Pressable style={styles.coverRemove} onPress={() => patch({ coverImageUri: null })} accessibilityLabel="Remove cover">
              <X size={16} color={Colors.white} strokeWidth={2.4} />
            </Pressable>
            <Pressable style={styles.coverChange} onPress={pickCover} accessibilityLabel="Change cover image">
              <ImagePlus size={14} color={Colors.white} strokeWidth={2} />
              <Text style={styles.coverChangeText}>Change</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.coverEmpty}>
            <ImagePlus size={28} color={Colors.primary} strokeWidth={1.8} />
            <Text style={styles.coverEmptyText}>Add a cover image</Text>
            <View style={styles.coverActions}>
              <Pressable style={styles.coverActionBtn} onPress={pickCover} accessibilityRole="button" accessibilityLabel="Choose from library">
                <Images size={16} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.coverActionText}>Library</Text>
              </Pressable>
              <Pressable style={styles.coverActionBtn} onPress={shootCover} accessibilityRole="button" accessibilityLabel="Take a photo">
                <Camera size={16} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.coverActionText}>Camera</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Text style={[styles.label, { marginTop: Spacing.lg }]}>Gallery (optional)</Text>
        <Text style={styles.hint}>Add up to 6 photos to tell your story.</Text>
        <View style={styles.galleryRow}>
          {draft.galleryUris.map((uri) => (
            <View key={uri} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
              <Pressable style={styles.thumbRemove} onPress={() => removeGallery(uri)} accessibilityLabel="Remove image">
                <X size={12} color={Colors.white} strokeWidth={2.6} />
              </Pressable>
            </View>
          ))}
          {draft.galleryUris.length < 6 && (
            <Pressable style={styles.thumbAdd} onPress={addGallery} accessibilityRole="button" accessibilityLabel="Add gallery images">
              <Plus size={20} color={Colors.primary} strokeWidth={2} />
            </Pressable>
          )}
        </View>

        <Text style={[styles.label, { marginTop: Spacing.lg }]}>Campaign video (optional)</Text>
        {draft.videoUri ? (
          <View style={styles.videoSelected}>
            <View style={styles.videoIcon}><Video size={18} color={Colors.secondary} strokeWidth={2} /></View>
            <Text style={styles.videoName} numberOfLines={1}>Video attached</Text>
            <Pressable onPress={() => patch({ videoUri: null })} hitSlop={8} accessibilityLabel="Remove video">
              <X size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.videoRow} onPress={pickVideo} accessibilityRole="button" accessibilityLabel="Add a video">
            <Video size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.videoText}>Add a campaign video</Text>
          </Pressable>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label={draft.coverImageUri ? 'Continue' : 'Add a cover to continue'} onPress={() => router.push('/crowdfunding/create/funding')} disabled={!draft.coverImageUri} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  coverBusy: { alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  coverBusyText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  coverError: { ...Typography.labelSm, color: Colors.error ?? '#ef4444', marginBottom: Spacing.xs },
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  coverWrap: { position: 'relative' },
  cover: { width: '100%', height: 180, borderRadius: Radius.lg },
  coverRemove: { position: 'absolute', top: Spacing.sm, right: Spacing.sm, width: 30, height: 30, borderRadius: Radius.full, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  coverChange: { position: 'absolute', bottom: Spacing.sm, right: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  coverChangeText: { ...Typography.caption, color: Colors.white, fontWeight: '600' as const },
  coverEmpty: { height: 200, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow },
  coverEmptyText: { ...Typography.labelMd, color: Colors.primary },
  coverActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  coverActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  coverActionText: { ...Typography.labelSm, color: Colors.primary },
  galleryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  thumbWrap: { position: 'relative' },
  thumb: { width: 80, height: 80, borderRadius: Radius.md },
  thumbRemove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  thumbAdd: { width: 80, height: 80, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  videoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, paddingHorizontal: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg },
  videoText: { ...Typography.labelMd, color: Colors.secondary },
  videoSelected: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, paddingHorizontal: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  videoIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  videoName: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
