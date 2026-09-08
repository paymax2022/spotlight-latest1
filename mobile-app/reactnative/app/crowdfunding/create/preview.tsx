import React from 'react';
import { ScrollView, View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, Pencil, ImageOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import WizardHeader from '@/features/crowdfunding/components/WizardHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignDraft } from '@/features/crowdfunding/store/campaignDraftStore';
import { useSubmitCampaign } from '@/features/crowdfunding/hooks/useCreator';
import { formatNaira, deadlineLabel } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import { alertAsync } from '@/lib/confirm';

const MODEL_LABEL: Record<string, string> = {
  ALL_OR_NOTHING: 'All-or-nothing', FLEXIBLE: 'Flexible funding', MILESTONE: 'Milestone-based', IMMEDIATE: 'Immediate', ESCROW: 'Escrow',
};

export default function CreatePreviewScreen() {
  const { draft, patch, reset, hasHydrated } = useCampaignDraft();
  const submit = useSubmitCampaign();

  // The draft store is in-memory only, so a web reload (or landing on this
  // route directly) wipes it while this screen still renders — type/category
  // come back null and the server rejects the POST with a bare 400. Check the
  // fields the API marks required before sending, and name the step to fix.
  // The draft is restored from storage asynchronously, so on the first render
  // it is still the empty default. Report nothing until hydration finishes —
  // but keep submit disabled meanwhile, otherwise a fast tap would POST the
  // empty draft and get the same 400 this guard exists to prevent.
  const missing: string[] = [];
  if (hasHydrated) {
    if (!draft.type) missing.push('campaign type');
    if (!draft.category) missing.push('category');
    if (!draft.title || draft.title.trim().length < 2) missing.push('title');
    if (!draft.goalKobo || draft.goalKobo < 100) missing.push('funding goal');
  }
  const canSubmit = hasHydrated && missing.length === 0;

  const go = (submitForReview: boolean) => {
    if (!hasHydrated) return;
    if (missing.length > 0) {
      void alertAsync({
        title: 'Campaign is incomplete',
        message: `Still needed: ${missing.join(', ')}. Pick up from step 1 — the rest of your draft is kept.`,
        buttonLabel: 'Back to start',
      }).then(() => router.dismissTo('/crowdfunding/create'));
      return;
    }
    submit.mutate(
      { draft, submitForReview },
      {
        onSuccess: (res) => {
          reset();
          router.replace(`/crowdfunding/create/success?status=${res.status}&id=${res.campaignId}`);
        },
        // Without this the mutation failed silently: no alert, nothing on
        // screen, only a 400 in the console.
        onError: (err: any) => {
          void alertAsync({
            title: 'Could not submit campaign',
            message:
              err?.response?.data?.error ??
              err?.message ??
              'Something went wrong. Please try again.',
          });
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WizardHeader step={9} totalSteps={9} title="Review & submit" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Card preview */}
        <View style={styles.previewCard}>
          {draft.coverImageUri ? (
            <Image source={{ uri: draft.coverImageUri }} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={[styles.cover, styles.coverEmpty]}><ImageOff size={22} color={Colors.outline} /></View>
          )}
          <View style={styles.previewBody}>
            <Text style={styles.previewCat}>{draft.category?.toUpperCase()}</Text>
            <Text style={styles.previewTitle}>{draft.title || 'Untitled campaign'}</Text>
            <Text style={styles.previewSummary} numberOfLines={2}>{draft.summary}</Text>
            <Text style={styles.previewGoal}>Goal {formatNaira(draft.goalKobo)} · {deadlineLabel(draft.deadline)}</Text>
          </View>
        </View>

        <Section label="Type & category" onEdit={() => router.dismissTo('/crowdfunding/create')} value={`${draft.type} · ${draft.category}`} />
        <Section label="Beneficiary" onEdit={() => router.push('/crowdfunding/create/beneficiary')} value={`${draft.beneficiaryName} (${draft.beneficiaryRelationship})`} />
        <Section label="Location" onEdit={() => router.push('/crowdfunding/create/funding')} value={draft.location} />
        <Section label="Disbursement" onEdit={() => router.push('/crowdfunding/create/funding')} value={MODEL_LABEL[draft.disbursementModel ?? ''] ?? '—'} />
        <Section label={`Budget (${draft.budget.length})`} onEdit={() => router.push('/crowdfunding/create/budget')} value={formatNaira(draft.budget.reduce((s, b) => s + b.amountKobo, 0))} />
        {draft.milestones.length > 0 && <Section label={`Milestones (${draft.milestones.length})`} onEdit={() => router.push('/crowdfunding/create/budget')} value={draft.milestones.map((m) => m.title).join(', ')} />}
        {draft.rewardTiers.length > 0 && <Section label={`Reward tiers (${draft.rewardTiers.length})`} onEdit={() => router.push('/crowdfunding/create/budget')} value={draft.rewardTiers.map((r) => r.title).join(', ')} />}

        {/* Refund policy */}
        <View style={styles.policyCard}>
          <Text style={styles.policyTitle}>Refund policy</Text>
          <Text style={styles.policyText}>{draft.refundPolicy}</Text>
        </View>

        {/* Acceptance */}
        <Pressable style={styles.acceptRow} onPress={() => patch({ acceptedPolicy: !draft.acceptedPolicy })} accessibilityRole="checkbox" accessibilityState={{ checked: draft.acceptedPolicy }}>
          <View style={[styles.checkbox, draft.acceptedPolicy && styles.checkboxOn]}>{draft.acceptedPolicy && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}</View>
          <Text style={styles.acceptText}>I confirm the information is accurate and accept Spotlight's fundraising policy and verification requirements.</Text>
        </Pressable>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Submit for review" onPress={() => go(true)} loading={submit.isPending} disabled={!draft.acceptedPolicy || !canSubmit} />
        {hasHydrated && missing.length > 0 && <Text style={styles.missing}>Missing: {missing.join(', ')}</Text>}
        <Pressable onPress={() => go(false)} disabled={submit.isPending || !hasHydrated} accessibilityRole="button" style={styles.draftBtn}>
          <Text style={styles.draftText}>Save as draft</Text>
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Section({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionBody}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <Text style={styles.sectionValue} numberOfLines={2}>{value || '—'}</Text>
      </View>
      <Pressable onPress={onEdit} hitSlop={8} style={styles.editBtn} accessibilityLabel={`Edit ${label}`}>
        <Pencil size={15} color={Colors.secondary} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  previewCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, overflow: 'hidden', marginBottom: Spacing.md },
  cover: { width: '100%', height: 150 },
  coverEmpty: { backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  previewBody: { padding: Spacing.md },
  previewCat: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, letterSpacing: 0.5 },
  previewTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2 },
  previewSummary: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 4 },
  previewGoal: { ...Typography.labelMd, color: Colors.teal, marginTop: Spacing.sm },
  section: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  sectionBody: { flex: 1 },
  sectionLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sectionValue: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 2 },
  editBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  policyCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.lg },
  policyTitle: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: 4 },
  policyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  acceptRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.md },
  checkbox: { width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  acceptText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  missing: { ...Typography.caption, color: Colors.error, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  draftBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  draftText: { ...Typography.labelLg, color: Colors.secondary },
});
