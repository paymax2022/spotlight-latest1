// ── Screen 31 — Report flow ──────────────────────────────────────────────────
// Always-accessible safety valve (never buried). Reason selector + optional
// evidence photo + optional "also block this user" toggle → POST /reports.
//
// Entry (route params): ?targetType=listing|seller|chat&targetId=<id>&targetName=<label>&sellerId=<id>
// Reached from the flag icon on Listing Detail, Seller Profile, and Chat.
// Submit → confirmation with the expected review timeframe, then back.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ImagePlus, CircleCheck, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { MarketColors } from '@/features/marketplace';
import { useCreateReport, useBlockUser } from '@/features/marketplace/api/account.hooks';
import type { ReportTargetType } from '@/features/marketplace/api/account.api';

const REASONS = [
  { key: 'prohibited_item', label: 'Prohibited or illegal item' },
  { key: 'counterfeit', label: 'Counterfeit / fake goods' },
  { key: 'scam_or_fraud', label: 'Scam or fraud attempt' },
  { key: 'off_platform', label: 'Trying to take the deal off Paymax' },
  { key: 'harassment', label: 'Harassment or abusive messages' },
  { key: 'misleading', label: 'Misleading listing / wrong details' },
  { key: 'other', label: 'Something else' },
];

export default function ReportFlow() {
  const params = useLocalSearchParams<{ targetType?: string; targetId?: string; targetName?: string; sellerId?: string }>();
  const targetType = (params.targetType as ReportTargetType) || 'listing';
  const targetId = params.targetId ?? '';
  const targetName = params.targetName ?? 'this item';
  const blockableUserId = params.sellerId || (targetType === 'seller' ? targetId : undefined);

  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [evidenceUri, setEvidenceUri] = useState<string | null>(null);
  const [alsoBlock, setAlsoBlock] = useState(false);

  const createReport = useCreateReport();
  const blockUser = useBlockUser();

  const canSubmit = useMemo(() => reason !== '' && targetId !== '', [reason, targetId]);

  const pickEvidence = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', `Allow access to your ${fromCamera ? 'camera' : 'photos'} to attach evidence.`);
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) setEvidenceUri(result.assets[0].uri);
  };

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await createReport.mutateAsync({
        targetType,
        targetId,
        reason: REASONS.find((r) => r.key === reason)?.label ?? reason,
        evidenceUrl: evidenceUri ?? undefined,
        note: note.trim() || undefined,
      });
      if (alsoBlock && blockableUserId) {
        try {
          await blockUser.mutateAsync({ blockedUserId: blockableUserId, blockedUserName: targetName });
        } catch {
          // Non-fatal: the report is filed regardless of the block outcome.
        }
      }
      Alert.alert(
        'Report received',
        "Thanks for flagging this. Our safety team reviews reports within 24 hours and will take action if our policies were broken.",
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert('Could not submit', (e as Error)?.message ?? 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Report a problem" subtitle={`Reporting ${targetName}`} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>Why are you reporting this?</Text>
        <View style={styles.reasons}>
          {REASONS.map((r) => {
            const active = reason === r.key;
            return (
              <Pressable
                key={r.key}
                style={[styles.reason, active && styles.reasonActive]}
                onPress={() => setReason(r.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <View style={[styles.radio, active && styles.radioActive]}>{active ? <Check size={13} color="#FFFFFF" /> : null}</View>
                <Text style={[styles.reasonLabel, active && styles.reasonLabelActive]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Add a note (optional)</Text>
        <TextInput
          style={styles.note}
          value={note}
          onChangeText={setNote}
          placeholder="Tell us what happened…"
          placeholderTextColor={MarketColors.muted}
          multiline
          maxLength={500}
        />

        <Text style={styles.sectionLabel}>Attach evidence (optional)</Text>
        {evidenceUri ? (
          <View style={styles.evidenceRow}>
            <Image source={{ uri: evidenceUri }} style={styles.evidenceThumb} />
            <Text style={styles.evidenceOk}>Photo attached</Text>
            <CircleCheck size={18} color={MarketColors.ok} />
            <Pressable onPress={() => setEvidenceUri(null)} hitSlop={8}><Text style={styles.remove}>Remove</Text></Pressable>
          </View>
        ) : (
          <View style={styles.uploadRow}>
            <Pressable style={styles.upload} onPress={() => pickEvidence(true)}>
              <Camera size={18} color={MarketColors.brand} />
              <Text style={styles.uploadLabel}>Take photo</Text>
            </Pressable>
            <Pressable style={styles.upload} onPress={() => pickEvidence(false)}>
              <ImagePlus size={18} color={MarketColors.brand} />
              <Text style={styles.uploadLabel}>Choose photo</Text>
            </Pressable>
          </View>
        )}

        {blockableUserId ? (
          <Pressable style={styles.blockToggle} onPress={() => setAlsoBlock((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: alsoBlock }}>
            <View style={[styles.checkbox, alsoBlock && styles.checkboxOn]}>{alsoBlock ? <Check size={14} color="#FFFFFF" /> : null}</View>
            <Text style={styles.blockLabel}>Also block {targetName} so they can’t contact me</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Submit report" onPress={submit} disabled={!canSubmit} loading={createReport.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  sectionLabel: { ...Typography.labelLg, color: MarketColors.text, marginTop: Spacing.md },
  reasons: { gap: Spacing.xs },
  reason: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface },
  reasonActive: { borderColor: MarketColors.brand, backgroundColor: Colors.primaryContainer },
  radio: { width: 20, height: 20, borderRadius: Radius.full, borderWidth: 1.5, borderColor: MarketColors.muted, alignItems: 'center', justifyContent: 'center' },
  radioActive: { backgroundColor: MarketColors.brand, borderColor: MarketColors.brand },
  reasonLabel: { ...Typography.bodyMd, color: MarketColors.text, flex: 1 },
  reasonLabelActive: { color: MarketColors.text, fontWeight: '600' },
  note: { minHeight: 88, borderRadius: Radius.md, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface, padding: Spacing.md, ...Typography.bodyMd, color: MarketColors.text, textAlignVertical: 'top' },
  uploadRow: { flexDirection: 'row', gap: Spacing.sm },
  upload: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surfaceAlt },
  uploadLabel: { ...Typography.labelLg, color: MarketColors.text },
  evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface },
  evidenceThumb: { width: 40, height: 40, borderRadius: Radius.sm },
  evidenceOk: { ...Typography.labelLg, color: MarketColors.text, flex: 1 },
  remove: { ...Typography.labelLg, color: MarketColors.danger },
  blockToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: MarketColors.surfaceAlt },
  checkbox: { width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: MarketColors.muted, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: MarketColors.danger, borderColor: MarketColors.danger },
  blockLabel: { ...Typography.bodyMd, color: MarketColors.text, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: MarketColors.border, backgroundColor: Colors.background },
});
