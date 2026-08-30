import React, { useState } from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ImagePlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import WizardProgress from '@/features/association/components/WizardProgress';
import { useOrgDraft } from '@/features/association/store/orgDraftStore';
import { pickDocument } from '@/features/association/utils/docPicker';
import { GROUP_TYPE_OPTIONS } from '@/features/association/constants/orgWizard.constants';
import { initials } from '@/features/association/utils/associationFormatters';
import { logoError, isRemoteLogoUrl, isUploadedLogoKey } from '@/features/association/utils/orgDraftValidation';
import { uploadLogo } from '@/features/association/api/logoUpload.api';
import TextInputField from '@/components/TextInputField';

export default function WizardBranding() {
  const { draft, patch } = useOrgDraft();
  const [touched, setTouched] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // The logo is REQUIRED, and one draft field backs both ways of supplying it:
  // a pasted URL and an uploaded image write the same `logoUri`. Whichever the
  // founder used last is the one that counts, so the two inputs can never hold
  // conflicting values.
  const logoIssue = logoError(draft.logoUri);
  const urlValue = draft.logoUri && isRemoteLogoUrl(draft.logoUri) ? draft.logoUri : '';
  const uploaded = isUploadedLogoKey(draft.logoUri);

  // An in-flight or failed upload must not count as a logo.
  const valid = Boolean(draft.groupType) && !logoIssue && !uploading && !uploadError;

  // Pick → preview immediately → upload → store the object key. The preview is
  // kept separately because the uploaded object is not publicly fetchable (the
  // backend signs it on read), so the key alone would render nothing here.
  const onLogo = async () => {
    const f = await pickDocument();
    if (!f) return;
    setUploadError(null);
    setUploading(true);
    // Clear any previous logo up front: leaving the old one in place while a new
    // upload runs would let a failed upload publish the image the founder just
    // replaced.
    patch({ logoPreviewUri: f.uri, logoUri: null });
    try {
      const objectKey = await uploadLogo(f.uri, f.name);
      patch({ logoUri: objectKey });
    } catch {
      setUploadError("That image couldn't be uploaded. Try again, or paste a logo URL instead.");
      patch({ logoPreviewUri: null });
    } finally {
      setUploading(false);
    }
  };

  const next = () => { setTouched(true); if (valid) router.push('/association/create/structure'); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create organisation" />
      <WizardProgress step={1} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Logo — required, by URL or upload */}
        <View style={styles.logoWrap}>
          <Pressable onPress={onLogo} accessibilityRole="button" accessibilityLabel="Upload logo">
            <View style={[styles.logo, touched && logoIssue ? styles.logoErrored : null]}>
              {uploading ? <ActivityIndicator color={Colors.primary} /> :
                draft.logoPreviewUri || urlValue ? <Image source={{ uri: draft.logoPreviewUri ?? urlValue }} style={styles.logoImg} /> : (
                  draft.acronym || draft.name ? <Text style={styles.logoText}>{draft.acronym || initials(draft.name)}</Text> : <ImagePlus size={26} color={Colors.primary} strokeWidth={2} />
                )}
            </View>
          </Pressable>
          <Text style={styles.logoHint}>{uploading ? 'Uploading…' : 'Tap to upload a logo'}</Text>
        </View>
        {uploadError ? <Text style={styles.error}>{uploadError}</Text> : null}

        <TextInputField
          label="Logo URL"
          placeholder="https://…"
          value={urlValue}
          onChangeText={(t) => patch({ logoUri: t.trim() ? t.trim() : null })}
          autoCapitalize="none"
          keyboardType="url"
          error={touched ? logoIssue : undefined}
        />
        {uploaded ? (
          <Text style={styles.logoNote}>Image uploaded. It will appear for members and in the admin console.</Text>
        ) : (
          <Text style={styles.logoNote}>Paste a link to your logo, or tap the badge above to upload an image.</Text>
        )}

        <Text style={styles.label}>Group type</Text>
        <Text style={styles.help}>How do members join your organisation?</Text>
        {/* Keyed on the group type itself, not on `valid` — `valid` now also
            covers the logo, so reusing it here would blame a missing logo on
            the group-type picker. */}
        {touched && !draft.groupType ? <Text style={styles.error}>Choose a group type</Text> : null}
        <View style={styles.gap}>
          {GROUP_TYPE_OPTIONS.map((opt) => {
            const active = draft.groupType === opt.value;
            return (
              <Pressable key={opt.value} onPress={() => patch({ groupType: opt.value })} style={[styles.option, active && styles.optionActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <View style={[styles.radio, active && styles.radioOn]}>{active ? <View style={styles.radioDot} /> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optLabel, active && styles.optLabelActive]}>{opt.label}</Text>
                  <Text style={styles.optHelp}>{opt.help}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={next} disabled={touched && !valid} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm, paddingTop: Spacing.sm },
  logoWrap: { alignItems: 'center', gap: 6, marginBottom: Spacing.sm },
  logo: { width: 96, height: 96, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImg: { width: '100%', height: '100%' },
  logoText: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
  logoHint: { ...Typography.labelSm, color: Colors.secondary },
  logoErrored: { borderWidth: 1.5, borderColor: Colors.error },
  logoNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: -Spacing.xs, marginBottom: Spacing.xs },
  label: { ...Typography.titleMd, color: Colors.onSurface },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  error: { ...Typography.labelSm, color: Colors.error },
  gap: { gap: Spacing.sm, marginTop: Spacing.xs },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, padding: Spacing.md },
  optionActive: { borderColor: Colors.primary },
  radio: { width: 22, height: 22, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: Radius.full, backgroundColor: Colors.primary },
  optLabel: { ...Typography.labelLg, color: Colors.onSurface },
  optLabelActive: { color: Colors.primary },
  optHelp: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
