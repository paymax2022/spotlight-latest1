import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import {
  ArrowLeft, Heart, Share2, Flag, ChevronRight, ShieldCheck, Receipt,
  Target, Megaphone, Users, FileText, HelpCircle, Gift, MapPin, Snowflake,
  CircleCheck, CalendarX, Ban, AlertTriangle, MessageCircle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import CampaignProgress from '@/features/crowdfunding/components/CampaignProgress';
import CampaignStatusBadge from '@/features/crowdfunding/components/CampaignStatusBadge';
import VerificationBadge from '@/features/crowdfunding/components/VerificationBadge';
import ContributorRow from '@/features/crowdfunding/components/ContributorRow';
import { useCampaign, useCampaignContributors, useToggleSave } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { recordCampaignEvent } from '@/features/crowdfunding/api/crowdfunding.api';
import { formatNaira, relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import type { CampaignStatus, DisbursementModel } from '@/features/crowdfunding/types/crowdfunding.types';

const DISBURSEMENT_LABEL: Record<DisbursementModel, string> = {
  IMMEDIATE: 'Funds released after admin-approved withdrawal',
  ALL_OR_NOTHING: 'All-or-nothing — refunded if the goal isn’t met',
  FLEXIBLE: 'Flexible funding — creator keeps whatever is raised',
  MILESTONE: 'Milestone-based — funds released per verified milestone',
  ESCROW: 'Held in escrow until the goal is reached',
};

const NOTICE: Partial<Record<CampaignStatus, { icon: React.ReactNode; title: string; body: string; tint: string; bg: string }>> = {
  FROZEN: { icon: <Snowflake size={20} color={Colors.error} strokeWidth={2} />, title: 'Campaign frozen', body: 'This campaign is under review by Trust & Safety. Contributions are paused.', tint: Colors.error, bg: Colors.iconBgRed },
  COMPLETED: { icon: <CircleCheck size={20} color={Colors.secondary} strokeWidth={2} />, title: 'Campaign completed', body: 'This campaign reached its goal and is no longer accepting contributions. Thank you!', tint: Colors.secondary, bg: Colors.iconBgBlue },
  EXPIRED: { icon: <CalendarX size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />, title: 'Campaign ended', body: 'The deadline for this campaign has passed.', tint: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  CANCELLED: { icon: <Ban size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />, title: 'Campaign cancelled', body: 'The creator cancelled this campaign. Any eligible contributions are being refunded.', tint: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  REJECTED: { icon: <Ban size={20} color={Colors.error} strokeWidth={2} />, title: 'Campaign unavailable', body: 'This campaign did not pass review and is not public.', tint: Colors.error, bg: Colors.iconBgRed },
};

export default function CampaignDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);

  // Record ONE view per mounted campaign — this is what the creator's Views,
  // Conversion and traffic-source figures are computed from. The ref guards
  // against React re-running the effect (StrictMode double-invoke, a refetch
  // changing deps) turning a single visit into several. `source` stays 'direct'
  // here; a deep link that carries a channel should pass it through instead.
  const viewRecorded = useRef<string | null>(null);
  useEffect(() => {
    if (!id || viewRecorded.current === id) return;
    viewRecorded.current = id;
    void recordCampaignEvent(id, 'VIEW', 'direct');
  }, [id]);
  const contributors = useCampaignContributors(id);
  const toggleSave = useToggleSave();

  if (isLoading) {
    return <SafeAreaView style={styles.safe}><FloatingBack /><StateView kind="loading" message="Loading campaign…" /></SafeAreaView>;
  }
  if (isError || !c) {
    return (
      <SafeAreaView style={styles.safe}>
        <FloatingBack />
        <StateView kind="error" icon="FileQuestion" title="Campaign not found" message="This campaign may have been removed." actionLabel="Go back" onAction={() => goBack('/crowdfunding')} />
      </SafeAreaView>
    );
  }

  const notice = NOTICE[c.status];
  const canContribute = c.status === 'ACTIVE';
  const link = (path: string) => router.push(`/crowdfunding/campaign/${c.id}/${path}` as never);

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Cover */}
        <View style={styles.cover}>
          {c.coverImage ? (
            <Image source={{ uri: c.coverImage }} style={styles.coverImg} resizeMode="cover" />
          ) : (
            <View style={[styles.coverImg, styles.coverPlaceholder]} />
          )}
          <SafeAreaView edges={['top']} style={styles.coverBar}>
            <Pressable onPress={() => goBack('/crowdfunding')} style={styles.circleBtn} accessibilityLabel="Go back">
              <ArrowLeft size={20} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
            <View style={styles.coverActions}>
              <Pressable onPress={() => router.push(`/crowdfunding/campaign/${c.id}/share`)} style={styles.circleBtn} accessibilityLabel="Share">
                <Share2 size={18} color={Colors.onSurface} strokeWidth={2} />
              </Pressable>
              <Pressable onPress={() => toggleSave.mutate({ id: c.id, saved: !c.saved })} style={styles.circleBtn} accessibilityLabel={c.saved ? 'Unsave' : 'Save'}>
                <Heart size={18} color={c.saved ? Colors.error : Colors.onSurface} fill={c.saved ? Colors.error : 'transparent'} strokeWidth={2} />
              </Pressable>
            </View>
          </SafeAreaView>
          {c.media.length > 1 && (
            <Pressable style={styles.galleryPill} onPress={() => link('media')}>
              <Text style={styles.galleryText}>+{c.media.length - 1} photos</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.container}>
          {/* Title + badges */}
          <View style={styles.badgeRow}>
            <Text style={styles.category}>{c.categoryLabel}</Text>
            <CampaignStatusBadge status={c.status} size="sm" />
          </View>
          <Text style={styles.title}>{c.title}</Text>
          <Text style={styles.summary}>{c.summary}</Text>

          {/* Status notice */}
          {notice && (
            <View style={[styles.notice, { backgroundColor: notice.bg }]}>
              {notice.icon}
              <View style={styles.noticeBody}>
                <Text style={[styles.noticeTitle, { color: notice.tint }]}>{notice.title}</Text>
                <Text style={styles.noticeText}>{notice.body}</Text>
              </View>
            </View>
          )}

          {/* Progress card */}
          <View style={[styles.card, shadow1]}>
            <CampaignProgress raisedKobo={c.raisedKobo} goalKobo={c.goalKobo} contributorCount={c.contributorCount} deadline={c.deadline} />
            <View style={styles.disbursement}>
              <ShieldCheck size={14} color={Colors.tertiaryContainer} strokeWidth={2} />
              <Text style={styles.disbursementText}>{DISBURSEMENT_LABEL[c.disbursementModel]}</Text>
            </View>
          </View>

          {/* Creator */}
          <Pressable style={styles.creatorRow} onPress={() => link('creator')} accessibilityRole="button">
            <View style={styles.creatorAvatar}>
              <Text style={styles.creatorInitial}>{c.creator.name.charAt(0)}</Text>
            </View>
            <View style={styles.creatorBody}>
              <View style={styles.creatorNameRow}>
                <Text style={styles.creatorName}>{c.creator.name}</Text>
                <VerificationBadge level={c.creator.verification} variant="icon" size={15} />
              </View>
              <Text style={styles.creatorMeta}>
                {c.creator.type[0] + c.creator.type.slice(1).toLowerCase()} · {c.creator.campaignsCreated} campaign{c.creator.campaignsCreated === 1 ? '' : 's'}
              </Text>
            </View>
            <ChevronRight size={20} color={Colors.outline} strokeWidth={2} />
          </Pressable>

          {/* Story preview */}
          <SectionBlock title="Story" onSeeAll={() => link('story')}>
            <Text style={styles.story} numberOfLines={5}>{c.story}</Text>
            <Text style={styles.readMore}>Read full story</Text>
          </SectionBlock>

          {/* Beneficiary */}
          {c.beneficiary && (
            <View style={styles.metaCard}>
              <Text style={styles.metaCardLabel}>Beneficiary</Text>
              <View style={styles.metaCardRow}>
                <Text style={styles.metaCardValue}>{c.beneficiary.name}</Text>
                {c.beneficiary.verified && <VerificationBadge level="KYC" variant="icon" size={14} />}
              </View>
              <Text style={styles.metaCardSub}>{c.beneficiary.relationship}{c.beneficiary.description ? ` · ${c.beneficiary.description}` : ''}</Text>
            </View>
          )}

          {/* Nav rows to sub-pages */}
          <NavRow icon={<Target size={18} color={Colors.primary} strokeWidth={2} />} label="Use of funds" sub={`${c.budget.length} budget items · ${formatNaira(c.goalKobo)}`} onPress={() => link('budget')} />
          {c.milestones.length > 0 && (
            <NavRow icon={<ShieldCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2} />} label="Milestones" sub={`${c.milestones.filter((m) => m.status === 'RELEASED').length}/${c.milestones.length} released`} onPress={() => link('milestones')} />
          )}
          {c.rewardTiers.length > 0 && (
            <NavRow icon={<Gift size={18} color={'#B65A00'} strokeWidth={2} />} label="Reward tiers" sub={`${c.rewardTiers.length} tiers available`} onPress={() => link('rewards')} />
          )}
          {c.documents.length > 0 && (
            <NavRow
              icon={<FileText size={18} color={Colors.secondary} strokeWidth={2} />}
              label="Documents"
              // Counts files, and says "verified" only about the ones that ARE.
              // This used to read "N verified file(s)" for every document on the
              // campaign — the word was part of the template, not a fact about the
              // rows. It went unnoticed while `documents` was hardcoded empty and
              // the row never rendered; the first real attachment made the page
              // tell backers a document had been checked when nothing had checked
              // it. `verified` is granted by review, and the copy has to mean it.
              sub={(() => {
                const total = c.documents.length;
                const verified = c.documents.filter((d) => d.verified).length;
                const files = `${total} file${total === 1 ? '' : 's'}`;
                return verified > 0 ? `${files} · ${verified} verified` : files;
              })()}
              onPress={() => link('documents')}
            />
          )}

          {/* Updates preview */}
          {c.updates.length > 0 && (
            <SectionBlock title="Updates" badge={c.updates.length} onSeeAll={() => link('updates')}>
              <View style={styles.updatePreview}>
                <Megaphone size={16} color={Colors.primary} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.updateTitle} numberOfLines={1}>{c.updates[0].title}</Text>
                  <Text style={styles.updateTime}>{relativeTime(c.updates[0].createdAt)}</Text>
                </View>
              </View>
            </SectionBlock>
          )}

          {/* Contributors preview */}
          <SectionBlock title="Backers" badge={c.contributorCount} onSeeAll={() => link('contributors')}>
            {contributors.isLoading ? (
              <StateView kind="loading" compact />
            ) : (contributors.data ?? []).length === 0 ? (
              <StateView kind="empty" compact icon="HeartHandshake" title="Be the first to give" message="No contributions yet — your support kicks this off." />
            ) : (
              (contributors.data ?? []).slice(0, 3).map((ct) => <ContributorRow key={ct.id} contributor={ct} />)
            )}
          </SectionBlock>

          {/* Comments & Q&A */}
          <NavRow icon={<MessageCircle size={18} color={Colors.secondary} strokeWidth={2} />} label="Comments & Q&A" sub="Ask the creator a question" onPress={() => link('comments')} />

          {/* FAQ */}
          {c.faqs.length > 0 && (
            <NavRow icon={<HelpCircle size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="FAQ" sub={`${c.faqs.length} questions answered`} onPress={() => link('faq')} />
          )}

          {/* Refund policy */}
          <View style={styles.refundCard}>
            <View style={styles.refundHead}>
              <Receipt size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.refundTitle}>Refund policy</Text>
            </View>
            <Text style={styles.refundText}>{c.refundPolicy}</Text>
          </View>

          {/* Risk disclosure */}
          {c.riskDisclosure && (
            <View style={styles.riskCard}>
              <AlertTriangle size={16} color={Colors.error} strokeWidth={2} />
              <Text style={styles.riskText}>{c.riskDisclosure}</Text>
            </View>
          )}

          {/* Report */}
          <Pressable style={styles.reportRow} onPress={() => router.push(`/crowdfunding/campaign/${c.id}/report`)} accessibilityRole="button">
            <Flag size={15} color={Colors.error} strokeWidth={2} />
            <Text style={styles.reportText}>Report this campaign</Text>
          </Pressable>

          {c.location && (
            <View style={styles.locationRow}>
              <MapPin size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.locationText}>{c.location}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      <SafeAreaView edges={['bottom']} style={styles.ctaBar}>
        {canContribute ? (
          <View style={styles.ctaInner}>
            <View style={styles.ctaAmounts}>
              <Text style={styles.ctaRaised}>{formatNaira(c.raisedKobo)}</Text>
              <Text style={styles.ctaRaisedSub}>raised so far</Text>
            </View>
            <View style={styles.ctaBtn}>
              <PrimaryButton label="Contribute" onPress={() => router.push(`/crowdfunding/contribute/${c.id}`)} />
            </View>
          </View>
        ) : (
          <PrimaryButton label="This campaign isn’t accepting contributions" onPress={() => {}} disabled />
        )}
      </SafeAreaView>
    </View>
  );
}

function FloatingBack() {
  return (
    <SafeAreaView edges={['top']} style={styles.floatingBack}>
      <Pressable onPress={() => goBack('/crowdfunding')} style={styles.circleBtn} accessibilityLabel="Go back">
        <ArrowLeft size={20} color={Colors.onSurface} strokeWidth={2} />
      </Pressable>
    </SafeAreaView>
  );
}

function SectionBlock({ title, badge, onSeeAll, children }: { title: string; badge?: number; onSeeAll?: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {badge != null && <Text style={styles.sectionBadge}>{badge.toLocaleString('en-NG')}</Text>}
        </View>
        {onSeeAll && (
          <Pressable onPress={onSeeAll} hitSlop={8}><Text style={styles.seeAll}>See all</Text></Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

function NavRow({ icon, label, sub, onPress }: { icon: React.ReactNode; label: string; sub: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.navRow, pressed && { opacity: 0.8 }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}. ${sub}`}>
      <View style={styles.navIcon}>{icon}</View>
      <View style={styles.navBody}>
        <Text style={styles.navLabel}>{label}</Text>
        <Text style={styles.navSub}>{sub}</Text>
      </View>
      <ChevronRight size={20} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1, backgroundColor: Colors.background },
  floatingBack: { position: 'absolute', top: 0, left: Spacing.containerMargin, zIndex: 10 },
  scroll: { paddingBottom: 120 },
  cover: { height: 280, backgroundColor: Colors.surfaceContainerHigh },
  coverImg: { width: '100%', height: '100%' },
  coverPlaceholder: { backgroundColor: Colors.surfaceContainerHigh },
  coverBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  coverActions: { flexDirection: 'row', gap: Spacing.sm },
  circleBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  galleryPill: { position: 'absolute', bottom: Spacing.md, right: Spacing.containerMargin, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  galleryText: { ...Typography.labelSm, color: Colors.white },
  container: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  category: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { ...Typography.headlineMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  summary: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  notice: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, marginBottom: Spacing.md },
  noticeBody: { flex: 1 },
  noticeTitle: { ...Typography.labelMd, marginBottom: 2 },
  noticeText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.md },
  disbursement: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  disbursementText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.surfaceContainerHigh },
  creatorAvatar: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  creatorInitial: { ...Typography.titleMd, color: Colors.primary },
  creatorBody: { flex: 1 },
  creatorNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  creatorName: { ...Typography.labelLg, color: Colors.onSurface },
  creatorMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  section: { marginTop: Spacing.lg },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionBadge: { ...Typography.labelSm, color: Colors.onSurfaceVariant, backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  seeAll: { ...Typography.labelMd, color: Colors.secondary },
  story: { ...Typography.bodyMd, color: Colors.onSurface },
  readMore: { ...Typography.labelMd, color: Colors.secondary, marginTop: Spacing.xs },
  metaCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  metaCardLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  metaCardRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaCardValue: { ...Typography.titleMd, color: Colors.onSurface },
  metaCardSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  navIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  navBody: { flex: 1 },
  navLabel: { ...Typography.labelLg, color: Colors.onSurface },
  navSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  updatePreview: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  updateTitle: { ...Typography.labelMd, color: Colors.onSurface },
  updateTime: { ...Typography.caption, color: Colors.onSurfaceVariant },
  refundCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.lg },
  refundHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  refundTitle: { ...Typography.labelMd, color: Colors.onSurface },
  refundText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  riskCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  riskText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  reportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.lg, paddingVertical: Spacing.sm },
  reportText: { ...Typography.labelMd, color: Colors.error },
  locationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: Spacing.sm },
  locationText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  ctaBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.96)', borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  ctaInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  ctaAmounts: {},
  ctaRaised: { ...Typography.titleMd, color: Colors.onSurface },
  ctaRaisedSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  ctaBtn: { flex: 1 },
});
