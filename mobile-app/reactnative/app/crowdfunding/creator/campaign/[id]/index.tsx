import React, { useState } from 'react';
import { ScrollView, View, Text, Image, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Pencil, PauseCircle, PlayCircle, Star, StarOff, Wallet, BarChart3,
  Trash2, TriangleAlert, Check, ChevronRight, Info,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { confirmAsync } from '@/lib/confirm';
import { goBack } from '@/lib/navigation';
import { getErrorMessage } from '@/utils/errorMapper';
import CampaignProgress from '@/features/crowdfunding/components/CampaignProgress';
import CampaignStatusBadge from '@/features/crowdfunding/components/CampaignStatusBadge';
import {
  useMyCampaign,
  useSetCampaignPaused,
  useDeleteCampaign,
  useRequestCampaignFeature,
  useWithdrawCampaignFeatureRequest,
  useUnfeatureCampaign,
} from '@/features/crowdfunding/hooks/useCreator';
import {
  canEdit, canPause, canResume, canDelete, canRequestFeature,
  canWithdrawFeatureRequest, canUnfeature, canWithdrawFunds, featureRequestState,
} from '@/features/crowdfunding/utils/ownerCampaignActions';

/**
 * Owner self-management for one campaign.
 *
 * Two rules shape every control here:
 *
 *  1. An action the server is certain to refuse is never offered as a live
 *     control. The gates in `ownerCampaignActions` mirror the API's own
 *     refusals (delete needs a campaign that never took money; a feature
 *     request needs an ACTIVE campaign), and a blocked row states the reason
 *     instead of leaving the owner to discover it as a 409.
 *  2. Nothing is rendered as done until the server says so. Every mutation
 *     writes back the campaign the server returned and then invalidates, so a
 *     refusal leaves the previous state on screen with the server's message
 *     next to it — a rejected write can never look applied.
 */
export default function ManageCampaignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { campaign, isLoading, isError, refetch } = useMyCampaign(id);

  // One banner pair for the whole screen: the last server refusal, and the last
  // server-confirmed change. Both are set only from a settled mutation.
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const pause = useSetCampaignPaused(id);
  const remove = useDeleteCampaign(id);
  const requestFeature = useRequestCampaignFeature(id);
  const withdrawFeature = useWithdrawCampaignFeatureRequest(id);
  const unfeature = useUnfeatureCampaign(id);

  const busy =
    pause.isPending || remove.isPending || requestFeature.isPending ||
    withdrawFeature.isPending || unfeature.isPending;

  /** Run a mutation, reporting only what actually settled. */
  const run = async (
    fn: () => Promise<unknown>,
    successMessage: string,
    confirmOpts?: Parameters<typeof confirmAsync>[0],
  ) => {
    if (confirmOpts && !(await confirmAsync(confirmOpts))) return;
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(successMessage);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Manage campaign" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (isError || !campaign) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Manage campaign" />
        <StateView
          kind={isError ? 'error' : 'empty'}
          icon="Megaphone"
          title={isError ? "Couldn't load this campaign" : 'Campaign not found'}
          message={isError ? undefined : 'It may have been deleted, or it belongs to another account.'}
          actionLabel={isError ? 'Retry' : 'Back to my campaigns'}
          onAction={isError ? refetch : () => goBack('/crowdfunding/creator/campaigns')}
        />
      </SafeAreaView>
    );
  }

  const editGate = canEdit(campaign);
  const pauseGate = canPause(campaign);
  const resumeGate = canResume(campaign);
  const deleteGate = canDelete(campaign);
  const requestGate = canRequestFeature(campaign);
  const withdrawReqGate = canWithdrawFeatureRequest(campaign);
  const unfeatureGate = canUnfeature(campaign);
  const fundsGate = canWithdrawFunds(campaign);
  const featureState = featureRequestState(campaign);
  const paused = campaign.paused;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Manage campaign"
        subtitle={campaign.title}
        onBack={() => goBack('/crowdfunding/creator/campaigns')}
      />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* ── Campaign summary ─────────────────────────────────────────── */}
        <View style={styles.hero}>
          {campaign.coverImage ? (
            <Image source={{ uri: campaign.coverImage }} style={styles.heroImg} resizeMode="cover" />
          ) : (
            <View style={[styles.heroImg, styles.heroPlaceholder]} />
          )}
        </View>

        <Text style={styles.title}>{campaign.title}</Text>
        <View style={styles.badges}>
          <CampaignStatusBadge status={campaign.status} paused={campaign.paused} />
          {campaign.featured ? (
            <View style={styles.featuredChip}>
              <Star size={12} color={Colors.secondary} strokeWidth={2.4} />
              <Text style={styles.featuredChipText}>Featured</Text>
            </View>
          ) : null}
          {featureState === 'PENDING' ? (
            <View style={styles.pendingChip}><Text style={styles.pendingChipText}>Feature request pending</Text></View>
          ) : null}
        </View>

        {paused ? (
          <View style={styles.infoBox}>
            <Info size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.infoText}>
              This campaign is paused. It is hidden from discovery and search, and is not accepting
              contributions until you resume it. Funds already raised are unaffected.
              {campaign.status !== 'ACTIVE'
                ? ` Its review status is also ${campaign.status.replace('_', ' ').toLowerCase()}, which you cannot change from here.`
                : ''}
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <CampaignProgress
            raisedKobo={campaign.raisedKobo}
            goalKobo={campaign.goalKobo}
            contributorCount={campaign.contributorCount}
            deadline={campaign.deadline}
          />
        </View>

        {/* ── Result banners (server-settled only) ─────────────────────── */}
        {error ? (
          <View style={[styles.banner, styles.bannerError]}>
            <TriangleAlert size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        ) : null}
        {notice ? (
          <View style={[styles.banner, styles.bannerOk]}>
            <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.4} />
            <Text style={styles.bannerText}>{notice}</Text>
          </View>
        ) : null}

        {/* ── Campaign ─────────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Campaign</Text>
        <View style={styles.group}>
          <ActionRow
            icon={<Pencil size={18} color={Colors.primary} strokeWidth={2} />}
            label="Edit details"
            description="Title, summary, story, category, cover image and goal."
            gate={editGate}
            onPress={() => router.push(`/crowdfunding/creator/campaign/${campaign.id}/edit`)}
          />
          <ActionRow
            icon={<BarChart3 size={18} color={Colors.primary} strokeWidth={2} />}
            label="Performance"
            description="Views, shares, conversion and daily raised."
            gate={{ allowed: true }}
            onPress={() => router.push(`/crowdfunding/creator/performance/${campaign.id}`)}
          />
        </View>

        {/* ── Visibility ───────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Visibility</Text>
        <View style={styles.group}>
          {paused ? (
            <ActionRow
              icon={<PlayCircle size={18} color={Colors.primary} strokeWidth={2} />}
              label="Resume campaign"
              description="Puts it back into public discovery and reopens contributions."
              gate={resumeGate}
              busy={pause.isPending}
              disabled={busy}
              onPress={() =>
                run(
                  () => pause.mutateAsync(false),
                  'Campaign resumed. It is live in discovery again.',
                  {
                    title: 'Resume this campaign?',
                    message: 'It will reappear in public discovery and start accepting contributions again.',
                    confirmLabel: 'Resume',
                  },
                )
              }
            />
          ) : (
            <ActionRow
              icon={<PauseCircle size={18} color={Colors.primary} strokeWidth={2} />}
              label="Pause campaign"
              description="Hides it from discovery and stops new contributions. Funds raised are untouched."
              gate={pauseGate}
              busy={pause.isPending}
              disabled={busy}
              onPress={() =>
                run(
                  () => pause.mutateAsync(true),
                  'Campaign paused. It is no longer visible in discovery.',
                  {
                    title: 'Pause this campaign?',
                    message:
                      'It will disappear from public discovery and search, and stop accepting new contributions. Money already raised is not affected, and you can resume at any time.',
                    confirmLabel: 'Pause',
                  },
                )
              }
            />
          )}

          {campaign.featured ? (
            <ActionRow
              icon={<StarOff size={18} color={Colors.primary} strokeWidth={2} />}
              label="Remove from featured"
              description="Takes your campaign off the featured rail on the home screen."
              gate={unfeatureGate}
              busy={unfeature.isPending}
              disabled={busy}
              onPress={() =>
                run(
                  () => unfeature.mutateAsync(),
                  'Removed from the featured rail.',
                  {
                    title: 'Remove from featured?',
                    message:
                      'Your campaign comes off the featured rail immediately. Getting the slot back needs a new request and admin approval.',
                    confirmLabel: 'Remove',
                    destructive: true,
                  },
                )
              }
            />
          ) : featureState === 'PENDING' ? (
            <ActionRow
              icon={<StarOff size={18} color={Colors.primary} strokeWidth={2} />}
              label="Withdraw feature request"
              description="Cancels the request sitting with the admin team."
              gate={withdrawReqGate}
              busy={withdrawFeature.isPending}
              disabled={busy}
              onPress={() =>
                run(
                  () => withdrawFeature.mutateAsync(),
                  'Feature request withdrawn.',
                  { title: 'Withdraw the feature request?', confirmLabel: 'Withdraw' },
                )
              }
            />
          ) : (
            <ActionRow
              icon={<Star size={18} color={Colors.primary} strokeWidth={2} />}
              label="Request to be featured"
              description="Asks an admin to place this campaign on the featured rail."
              gate={requestGate}
              busy={requestFeature.isPending}
              disabled={busy}
              onPress={() =>
                run(
                  () => requestFeature.mutateAsync(),
                  'Feature request sent. An admin will review it.',
                )
              }
            />
          )}
        </View>

        {/* ── Funds ────────────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Funds</Text>
        <View style={styles.group}>
          <ActionRow
            icon={<Wallet size={18} color={Colors.primary} strokeWidth={2} />}
            label="Withdraw funds"
            description="Send available funds from this campaign to your bank account."
            gate={fundsGate}
            onPress={() =>
              router.push({
                pathname: '/crowdfunding/wallet/withdraw',
                params: { campaign: campaign.id },
              })
            }
          />
          <ActionRow
            icon={<BarChart3 size={18} color={Colors.primary} strokeWidth={2} />}
            label="Withdrawal history"
            description="Every request you have made and where it stands."
            gate={{ allowed: true }}
            onPress={() => router.push('/crowdfunding/creator/withdrawals')}
          />
        </View>

        {/* ── Danger zone ──────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, styles.sectionDanger]}>Danger zone</Text>
        <View style={[styles.group, styles.groupDanger]}>
          <View style={styles.dangerHead}>
            <Trash2 size={18} color={Colors.error} strokeWidth={2} />
            <Text style={styles.dangerTitle}>Delete this campaign</Text>
          </View>

          {deleteGate.allowed ? (
            <>
              <Text style={styles.dangerBody}>
                This removes the campaign and everything on it permanently. It cannot be undone.
              </Text>
              {/* Two gates for an irreversible action: the checkbox arms it, the
                  confirm dialog commits it — matching the account-deletion flow. */}
              <Pressable
                style={styles.ackRow}
                onPress={() => setDeleteArmed((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: deleteArmed }}
              >
                <View style={[styles.checkbox, deleteArmed && styles.checkboxOn]}>
                  {deleteArmed ? <Check size={13} color={Colors.onError} strokeWidth={3} /> : null}
                </View>
                <Text style={styles.ackText}>I understand this is permanent.</Text>
              </Pressable>
              <Pressable
                style={[styles.deleteBtn, (!deleteArmed || busy) && styles.deleteBtnDisabled]}
                disabled={!deleteArmed || busy}
                accessibilityRole="button"
                accessibilityLabel="Delete this campaign"
                onPress={() =>
                  run(
                    async () => {
                      await remove.mutateAsync();
                      // Only after the server confirmed the delete does the
                      // screen for a now-nonexistent campaign go away.
                      goBack('/crowdfunding/creator/campaigns');
                    },
                    'Campaign deleted.',
                    {
                      title: 'Delete this campaign?',
                      message: `“${campaign.title}” will be permanently deleted. This cannot be undone.`,
                      confirmLabel: 'Delete',
                      destructive: true,
                    },
                  )
                }
              >
                {remove.isPending
                  ? <ActivityIndicator color={Colors.onError} size="small" />
                  : <Text style={styles.deleteText}>Delete campaign</Text>}
              </Pressable>
            </>
          ) : (
            <Text style={styles.dangerBody}>{deleteGate.reason}</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Action row ───────────────────────────────────────────────────────────────

interface ActionRowProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  /** When not allowed the row is inert and shows `gate.reason` instead. */
  gate: { allowed: boolean; reason?: string };
  onPress: () => void;
  busy?: boolean;
  /** Another mutation is in flight — inert, but not "unavailable". */
  disabled?: boolean;
}

function ActionRow({ icon, label, description, gate, onPress, busy, disabled }: ActionRowProps) {
  const inert = !gate.allowed || busy || disabled;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, inert && styles.rowInert, pressed && !inert && styles.rowPressed]}
      onPress={inert ? undefined : onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert }}
      accessibilityLabel={gate.allowed ? label : `${label}, unavailable. ${gate.reason ?? ''}`}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDesc}>{gate.allowed ? description : gate.reason}</Text>
      </View>
      {busy
        ? <ActivityIndicator size="small" color={Colors.primary} />
        : gate.allowed
          ? <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 100 },

  hero: { borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceContainerHigh },
  heroImg: { width: '100%', height: 150 },
  heroPlaceholder: { backgroundColor: Colors.surfaceContainerHigh },

  title: { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm },
  featuredChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5, backgroundColor: Colors.iconBgBlue },
  featuredChipText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '600' as const },
  pendingChip: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5, backgroundColor: Colors.iconBgGold },
  pendingChipText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' as const },

  infoBox: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  infoText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },

  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginTop: Spacing.md },

  banner: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  bannerError: { backgroundColor: Colors.errorContainer },
  bannerOk: { backgroundColor: Colors.iconBgTeal },
  bannerText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },

  sectionTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  sectionDanger: { color: Colors.error },

  group: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  groupDanger: { borderColor: Colors.error, padding: Spacing.md, gap: Spacing.sm },

  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  rowInert: { opacity: 0.55 },
  rowPressed: { backgroundColor: Colors.surfaceContainerLow },
  rowIcon: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rowDesc: { ...Typography.labelSm, color: Colors.onSurfaceVariant },

  dangerHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dangerTitle: { ...Typography.titleMd, color: Colors.error },
  dangerBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.xs },
  checkbox: { width: 20, height: 20, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.error, borderColor: Colors.error },
  ackText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  deleteBtn: { height: 52, borderRadius: Radius.lg, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.xs },
  deleteBtnDisabled: { opacity: 0.45 },
  deleteText: { ...Typography.labelLg, color: Colors.onError },
});
