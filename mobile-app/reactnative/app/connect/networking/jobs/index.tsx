import React, { useMemo, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Briefcase,
  MapPin,
  Users,
  Wifi,
  Bookmark,
  ClipboardList,
  BadgeCheck,
  Gift,
  ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SearchBar from '@/components/SearchBar';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { JOB_EMPLOYMENT_TYPES } from '@/features/connect/networking/jobs/api';
import { useJobs, useOpenToWork } from '@/features/connect/networking/jobs/hooks';
import type { JobFilters, JobPosting, EmploymentType } from '@/features/connect/networking/jobs/types';

const EMPLOYMENT_LABEL: Record<EmploymentType, string> = JOB_EMPLOYMENT_TYPES.reduce(
  (acc, t) => ({ ...acc, [t.value]: t.label }),
  {} as Record<EmploymentType, string>,
);

function formatSalary(job: JobPosting): string {
  if (!job.salaryMinKobo && !job.salaryMaxKobo) return 'Undisclosed';
  const per = job.salaryPeriod === 'month' ? '/mo' : '/yr';
  if (job.salaryMinKobo && job.salaryMaxKobo && job.salaryMinKobo !== job.salaryMaxKobo) {
    return `${formatKobo(job.salaryMinKobo)}–${formatKobo(job.salaryMaxKobo)}${per}`;
  }
  return `${formatKobo(job.salaryMaxKobo || job.salaryMinKobo)}${per}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

const BASE_FILTERS: Omit<JobFilters, 'query'> = {
  location: '',
  remoteOnly: false,
  employmentTypes: [],
  skills: [],
};

const TYPE_CHIPS: EmploymentType[] = ['full_time', 'contract', 'internship'];

/** Jobs feed (PRD §6.1 JB-01). Search + quick employment-type / remote filters. */
export default function JobsFeedScreen() {
  const [query, setQuery] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [types, setTypes] = useState<EmploymentType[]>([]);

  const filters: JobFilters = useMemo(
    () => ({ ...BASE_FILTERS, query, remoteOnly, employmentTypes: types }),
    [query, remoteOnly, types],
  );
  const jobsQuery = useJobs(filters);
  const otw = useOpenToWork();
  const jobs = jobsQuery.data ?? [];

  function toggleType(t: EmploymentType) {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function renderBody() {
    if (jobsQuery.isLoading) {
      return <StateView kind="loading" message="Finding roles for you…" />;
    }
    if (jobsQuery.isError) {
      return (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Couldn't load jobs"
          message="Something went wrong fetching postings."
          actionLabel="Retry"
          onAction={() => jobsQuery.refetch()}
        />
      );
    }
    if (jobs.length === 0) {
      return (
        <StateView
          kind="empty"
          icon="Briefcase"
          title="No jobs match"
          message="Try clearing your search or filters."
        />
      );
    }
    return (
      <View style={styles.list}>
        {jobs.map((j) => (
          <JobCard key={j.id} job={j} />
        ))}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Jobs"
        rightSlot={
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="My applications"
            onPress={() => router.push('/connect/networking/jobs/my-applications')}
          >
            <ClipboardList size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <SearchBar
          placeholder="Search title, company, skill…"
          value={query}
          onChangeText={setQuery}
        />

        {/* Open to Work signal (JB-07) */}
        <Pressable
          style={styles.otwCard}
          accessibilityRole="button"
          onPress={() => router.push('/connect/networking/jobs/open-to-work')}
        >
          <View style={[styles.otwIcon, otw.data?.enabled && styles.otwIconOn]}>
            <BadgeCheck
              size={20}
              color={otw.data?.enabled ? ConnectColors.ok : Colors.onSurfaceVariant}
              strokeWidth={2}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.otwTitle}>Open to Work</Text>
            <Text style={styles.otwSub}>
              {otw.data?.enabled ? 'On · visible to recruiters' : 'Let recruiters know you’re open'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>

        {/* Quick filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <FilterChip
            label="Remote"
            icon={<Wifi size={14} color={remoteOnly ? Colors.onPrimary : Colors.onSurfaceVariant} strokeWidth={2.2} />}
            active={remoteOnly}
            onPress={() => setRemoteOnly((v) => !v)}
          />
          {TYPE_CHIPS.map((t) => (
            <FilterChip
              key={t}
              label={EMPLOYMENT_LABEL[t]}
              active={types.includes(t)}
              onPress={() => toggleType(t)}
            />
          ))}
        </ScrollView>

        {renderBody()}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {icon}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function JobCard({ job }: { job: JobPosting }) {
  return (
    <Pressable
      style={styles.card}
      accessibilityRole="button"
      onPress={() => router.push(`/connect/networking/jobs/${encodeURIComponent(job.id)}`)}
    >
      <View style={styles.cardTop}>
        {job.companyLogo ? (
          <Image source={{ uri: job.companyLogo }} style={styles.logo} />
        ) : (
          <View style={[styles.logo, styles.logoFallback]}>
            <Briefcase size={20} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
          </View>
        )}
        <View style={styles.cardHead}>
          <Text style={styles.title} numberOfLines={2}>{job.title}</Text>
          <Text style={styles.company} numberOfLines={1}>{job.company}</Text>
        </View>
        {job.saved ? <Bookmark size={18} color={ConnectColors.brand} fill={ConnectColors.brand} strokeWidth={2} /> : null}
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <MapPin size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.metaText}>{job.isRemote ? `${job.location} · Remote` : job.location}</Text>
        </View>
        <View style={styles.dot} />
        <Text style={styles.metaText}>{EMPLOYMENT_LABEL[job.employmentType]}</Text>
      </View>

      <Text style={styles.salary}>{formatSalary(job)}</Text>

      <View style={styles.cardFooter}>
        <View style={styles.metaItem}>
          <Users size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.metaText}>{job.applicantCount} applied</Text>
        </View>
        <View style={styles.footerRight}>
          {job.bountyKobo > 0 ? (
            <View style={styles.bountyPill}>
              <Gift size={12} color={ConnectColors.warn} strokeWidth={2.4} />
              <Text style={styles.bountyText}>{formatKobo(job.bountyKobo)} bounty</Text>
            </View>
          ) : null}
          <Text style={styles.posted}>{timeAgo(job.postedAt)}</Text>
        </View>
      </View>

      {job.applied ? (
        <View style={styles.appliedTag}>
          <BadgeCheck size={13} color={ConnectColors.ok} strokeWidth={2.4} />
          <Text style={styles.appliedText}>Applied</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  otwCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  otwIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerHigh,
  },
  otwIconOn: { backgroundColor: Colors.iconBgTeal },
  otwTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  otwSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  filterRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerMargin,
    paddingBottom: Spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  chipActive: { backgroundColor: ConnectColors.brand, borderColor: ConnectColors.brand },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant, fontWeight: '600' },
  chipTextActive: { color: Colors.onPrimary },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.cardPadding,
    gap: Spacing.xs,
  },
  cardTop: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  logo: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  logoFallback: { alignItems: 'center', justifyContent: 'center' },
  cardHead: { flex: 1, gap: 2 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  company: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: Colors.outline },
  salary: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700', marginTop: 2 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bountyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.iconBgGold,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  bountyText: { ...Typography.caption, color: Colors.onWarning, fontWeight: '700' },
  posted: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  appliedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: Spacing.xs,
  },
  appliedText: { ...Typography.caption, color: ConnectColors.ok, fontWeight: '700' },
});
