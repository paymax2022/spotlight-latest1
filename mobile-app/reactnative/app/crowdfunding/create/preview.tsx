import React from 'react';
import { ScrollView, View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, Pencil, ImageOff, AlertCircle, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import WizardHeader from '@/features/crowdfunding/components/WizardHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignDraft } from '@/features/crowdfunding/store/campaignDraftStore';
import { useSubmitCampaign } from '@/features/crowdfunding/hooks/useCreator';
import { formatNaira, deadlineLabel } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import { CAMPAIGN_CATEGORIES } from '@/features/crowdfunding/constants/crowdfunding.constants';
import type { CampaignDraftInput } from '@/features/crowdfunding/types/crowdfunding.types';

const MODEL_LABEL: Record<string, string> = {
  ALL_OR_NOTHING: 'All-or-nothing', FLEXIBLE: 'Flexible funding', MILESTONE: 'Milestone-based', IMMEDIATE: 'Immediate', ESCROW: 'Escrow',
};

const TYPE_LABEL: Record<string, string> = {
  DONATION: 'Donation', REWARD: 'Reward / Project', COMMUNITY: 'Community', SME: 'SME / Business', INVESTMENT: 'Investment',
};

const PLACEHOLDER = 'Not set';
const MIN_GOAL_KOBO = 100_000; // ₦1,000 — matches the Goal & funding Continue gate

function categoryLabel(slug: string | null): string | null {
  if (!slug) return null;
  return CAMPAIGN_CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
}

/**
 * Missing required fields for a submittable campaign. Each rule mirrors the
 * per-step Continue gate so preview can't accept what a step would have blocked.
 * Order matches the wizard so the checklist reads top-to-bottom.
 */
type MissingItem = { key: string; label: string; go: () => void };

function collectMissing(draft: CampaignDraftInput): MissingItem[] {
  const missing: MissingItem[] = [];
  const goDismiss = (path: string) => () => router.dismissTo(path as never);
  const goPush = (path: string) => () => router.push(path as never);

  if (!draft.type) missing.push({ key: 'type', label: 'Campaign type', go: goDismiss('/crowdfunding/create') });
  if (!draft.category) missing.push({ key: 'category', label: 'Category', go: goPush('/crowdfunding/create/category') });
  if (draft.title.trim().length < 8) missing.push({ key: 'title', label: 'Title (at least 8 characters)', go: goPush('/crowdfunding/create/details') });
  if (draft.summary.trim().length < 20) missing.push({ key: 'summary', label: 'Short summary (at least 20 characters)', go: goPush('/crowdfunding/create/details') });
  if (draft.story.trim().length < 80) missing.push({ key: 'story', label: 'Story (at least 80 characters)', go: goPush('/crowdfunding/create/story') });
  if (!draft.coverImageUri) missing.push({ key: 'cover', label: 'Cover image', go: goPush('/crowdfunding/create/media') });
  if (draft.goalKobo < MIN_GOAL_KOBO) missing.push({ key: 'goal', label: 'Funding goal (at least ₦1,000)', go: goPush('/crowdfunding/create/funding') });
  if (draft.location.trim().length <= 1) missing.push({ key: 'location', label: 'Location', go: goPush('/crowdfunding/create/funding') });
  if (draft.disbursementModel == null) missing.push({ key: 'disbursement', label: 'Disbursement model', go: goPush('/crowdfunding/create/funding') });
  if (draft.beneficiaryName.trim().length <= 1 || draft.beneficiaryRelationship.length === 0) {
    missing.push({ key: 'beneficiary', label: 'Beneficiary name & relationship', go: goPush('/crowdfunding/create/beneficiary') });
  }
  if (draft.budget.length < 1) missing.push({ key: 'budget', label: 'At least one budget item', go: goPush('/crowdfunding/create/budget') });

  return missing;
}

export default function CreatePreviewScreen() {
  const { draft, patch, reset } = useCampaignDraft();
  const submit = useSubmitCampaign();

  const missing = React.useMemo(() => collectMissing(draft), [draft]);
  const isComplete = missing.length === 0;
  const canSubmit = draft.acceptedPolicy && isComplete;

  const go = (submitForReview: boolean) => {
    // Defence in depth: the Submit button is disabled when incomplete, but never
    // let a "submit for review" fall through to a silent draft save.
    if (submitForReview && !canSubmit) return;
    submit.mutate(
      { draft, submitForReview },
      {
        onSuccess: (res) => {
          reset();
          router.replace(`/crowdfunding/create/success?status=${res.status}&id=${res.campaignId}`);
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
            {categoryLabel(draft.category) && <Text style={styles.previewCat}>{categoryLabel(draft.category)!.toUpperCase()}</Text>}
            <Text style={styles.previewTitle}>{draft.title.trim() || 'Untitled campaign'}</Text>
            {draft.summary.trim().length > 0 && <Text style={styles.previewSummary} numberOfLines={2}>{draft.summary}</Text>}
            <Text style={styles.previewGoal}>Goal {formatNaira(draft.goalKobo)} · {deadlineLabel(draft.deadline)}</Text>
          </View>
        </View>

        <Section
          label="Type & category"
          onEdit={() => router.dismissTo('/crowdfunding/create')}
          value={`${TYPE_LABEL[draft.type ?? ''] ?? PLACEHOLDER} · ${categoryLabel(draft.category) ?? PLACEHOLDER}`}
        />
        <Section
          label="Beneficiary"
          onEdit={() => router.push('/crowdfunding/create/beneficiary')}
          value={draft.beneficiaryName.trim() ? `${draft.beneficiaryName}${draft.beneficiaryRelationship ? ` (${draft.beneficiaryRelationship})` : ''}` : PLACEHOLDER}
        />
        <Section label="Location" onEdit={() => router.push('/crowdfunding/create/funding')} value={draft.location.trim() || PLACEHOLDER} />
        <Section label="Disbursement" onEdit={() => router.push('/crowdfunding/create/funding')} value={draft.disbursementModel ? (MODEL_LABEL[draft.disbursementModel] ?? PLACEHOLDER) : PLACEHOLDER} />
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

        {/* Completeness gate — what still blocks submission */}
        {!isComplete && (
          <View style={styles.missingCard} accessibilityLabel={`${missing.length} item${missing.length === 1 ? '' : 's'} needed before submitting`}>
            <View style={styles.missingHead}>
              <AlertCircle size={16} color={Colors.error} strokeWidth={2} />
              <Text style={styles.missingTitle}>Complete these before submitting for review</Text>
            </View>
            {missing.map((m) => (
              <Pressable key={m.key} style={styles.missingRow} onPress={m.go} accessibilityRole="button" accessibilityLabel={`Fix ${m.label}`}>
                <Text style={styles.missingItem}>{m.label}</Text>
                <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            ))}
            <Text style={styles.missingFoot}>You can still Save as draft and finish later.</Text>
          </View>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Submit for review" onPress={() => go(true)} loading={submit.isPending} disabled={!canSubmit} />
        {isComplete && !draft.acceptedPolicy && (
          <Text style={styles.hintText}>Tick the confirmation above to submit.</Text>
        )}
        <Pressable onPress={() => go(false)} disabled={submit.isPending} accessibilityRole="button" style={styles.draftBtn}>
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
        <Text style={styles.sectionValue} numberOfLines={2}>{value || PLACEHOLDER}</Text>
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
  missingCard: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  missingHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.xs },
  missingTitle: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  missingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  missingItem: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  missingFoot: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  hintText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  draftBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  draftText: { ...Typography.labelLg, color: Colors.secondary },
});
