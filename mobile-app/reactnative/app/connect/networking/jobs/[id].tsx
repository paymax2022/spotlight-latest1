import React from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Briefcase,
  MapPin,
  Users,
  Wifi,
  Clock,
  Gift,
  CheckCircle2,
  BadgeCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { JOB_EMPLOYMENT_TYPES } from '@/features/connect/networking/jobs/api';
import { useJob } from '@/features/connect/networking/jobs/hooks';
import type { JobPosting, EmploymentType } from '@/features/connect/networking/jobs/types';

const EMPLOYMENT_LABEL: Record<EmploymentType, string> = JOB_EMPLOYMENT_TYPES.reduce(
  (acc, t) => ({ ...acc, [t.value]: t.label }),
  {} as Record<EmploymentType, string>,
);

function formatSalary(job: JobPosting): string {
  if (!job.salaryMinKobo && !job.salaryMaxKobo) return 'Undisclosed';
  const per = job.salaryPeriod === 'month' ? '/mo' : '/yr';
  if (job.salaryMinKobo && job.salaryMaxKobo && job.salaryMinKobo !== job.salaryMaxKobo) {
    return `${formatKobo(job.salaryMinKobo)} – ${formatKobo(job.salaryMaxKobo)}${per}`;
  }
  return `${formatKobo(job.salaryMaxKobo || job.salaryMinKobo)}${per}`;
}

/** Job detail (PRD §6.1 JB-02). Sticky apply CTA at the bottom. */
export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = String(id ?? '');
  const jobQuery = useJob(jobId);
  const job = jobQuery.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Job" />
      {jobQuery.isLoading ? (
        <StateView kind="loading" message="Loading job…" />
      ) : jobQuery.isError ? (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Couldn't load job"
          message="Something went wrong."
          actionLabel="Retry"
          onAction={() => jobQuery.refetch()}
        />
      ) : !job ? (
        <StateView kind="empty" icon="Briefcase" title="Job not found" />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <View style={styles.header}>
              {job.companyLogo ? (
                <Image source={{ uri: job.companyLogo }} style={styles.logo} />
              ) : (
                <View style={[styles.logo, styles.logoFallback]}>
                  <Briefcase size={28} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
                </View>
              )}
              <Text style={styles.title}>{job.title}</Text>
              <Text style={styles.company}>{job.company}</Text>
              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  {job.isRemote ? (
                    <Wifi size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  ) : (
                    <MapPin size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  )}
                  <Text style={styles.metaText}>{job.isRemote ? `${job.location} · Remote` : job.location}</Text>
                </View>
                <View style={styles.dot} />
                <Text style={styles.metaText}>{EMPLOYMENT_LABEL[job.employmentType]}</Text>
                <View style={styles.dot} />
                <Text style={styles.metaText}>{job.seniority}</Text>
              </View>
            </View>

            {/* Highlight tiles */}
            <View style={styles.tiles}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Salary</Text>
                <Text style={styles.tileValue}>{formatSalary(job)}</Text>
              </View>
              <View style={styles.tile}>
                <View style={styles.tileIconRow}>
                  <Users size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.tileValue}>{job.applicantCount}</Text>
                </View>
                <Text style={styles.tileLabel}>Applicants</Text>
              </View>
            </View>

            {job.bountyKobo > 0 ? (
              <View style={styles.bountyBanner}>
                <Gift size={18} color={ConnectColors.warn} strokeWidth={2.2} />
                <Text style={styles.bountyText}>
                  Refer someone and earn {formatKobo(job.bountyKobo)} if they’re hired.
                </Text>
              </View>
            ) : null}

            <Section title="About the role">
              <Text style={styles.body}>{job.description}</Text>
            </Section>

            {job.responsibilities.length ? (
              <Section title="What you’ll do">
                {job.responsibilities.map((r, i) => (
                  <Bullet key={i} text={r} />
                ))}
              </Section>
            ) : null}

            {job.requirements.length ? (
              <Section title="Requirements">
                {job.requirements.map((r, i) => (
                  <Bullet key={i} text={r} />
                ))}
              </Section>
            ) : null}

            {job.skills.length ? (
              <Section title="Skills">
                <DiscoveryChipRow items={job.skills} variant="static" />
              </Section>
            ) : null}

            <View style={styles.postedRow}>
              <Clock size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.metaText}>Posted by {job.recruiterName}</Text>
            </View>

            <View style={{ height: Spacing.xxl }} />
          </ScrollView>

          <View style={styles.sticky}>
            {job.applied ? (
              <View style={[styles.stickyBtn, styles.stickyApplied]}>
                <BadgeCheck size={18} color={ConnectColors.ok} strokeWidth={2.2} />
                <Text style={[styles.stickyText, { color: ConnectColors.ok }]}>Applied</Text>
              </View>
            ) : (
              <Pressable
                style={[styles.stickyBtn, styles.stickyPrimary]}
                accessibilityRole="button"
                onPress={() =>
                  router.push(
                    `/connect/networking/jobs/apply?id=${encodeURIComponent(job.id)}&title=${encodeURIComponent(job.title)}&company=${encodeURIComponent(job.company)}`,
                  )
                }
              >
                <CheckCircle2 size={18} color={Colors.onPrimary} strokeWidth={2.2} />
                <Text style={[styles.stickyText, { color: Colors.onPrimary }]}>
                  {job.easyApply ? 'Easy apply' : 'Apply now'}
                </Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin },
  header: { alignItems: 'center', gap: 4, paddingTop: Spacing.sm },
  logo: { width: 72, height: 72, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  logoFallback: { alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  company: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outline },
  tiles: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
  tile: {
    flex: 1,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    gap: 4,
  },
  tileIconRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  tileValue: { ...Typography.titleMd, color: Colors.onSurface },
  bountyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  bountyText: { ...Typography.labelMd, color: Colors.onWarning, flex: 1, fontWeight: '600' },
  section: { marginTop: Spacing.lg, gap: Spacing.sm },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  bulletRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ConnectColors.brand, marginTop: 7 },
  bulletText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 22 },
  postedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.lg },
  sticky: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
  stickyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 56,
    borderRadius: Radius.lg,
  },
  stickyPrimary: { backgroundColor: ConnectColors.brand },
  stickyApplied: { backgroundColor: Colors.iconBgTeal },
  stickyText: { ...Typography.labelLg, fontWeight: '700' },
});
