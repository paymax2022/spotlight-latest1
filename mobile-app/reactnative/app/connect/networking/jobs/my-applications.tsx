import React from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Briefcase, Info, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useMyApplications } from '@/features/connect/networking/jobs/hooks';
import ApplicationStateBadge from '@/features/connect/networking/jobs/ApplicationStateBadge';
import type { JobApplication } from '@/features/connect/networking/jobs/types';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/** My applications status tracker (PRD §6.1 JB-04). */
export default function MyApplicationsScreen() {
  const appsQuery = useMyApplications();
  const apps = appsQuery.data ?? [];

  function renderBody() {
    if (appsQuery.isLoading) {
      return <StateView kind="loading" message="Loading your applications…" />;
    }
    if (appsQuery.isError) {
      return (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Couldn't load applications"
          message="Something went wrong."
          actionLabel="Retry"
          onAction={() => appsQuery.refetch()}
        />
      );
    }
    if (apps.length === 0) {
      return (
        <StateView
          kind="empty"
          icon="ClipboardList"
          title="No applications yet"
          message="Roles you apply to will appear here."
          actionLabel="Browse jobs"
          onAction={() => router.replace('/connect/networking/jobs')}
        />
      );
    }
    return (
      <View style={styles.list}>
        {apps.map((a) => (
          <ApplicationCard key={a.id} application={a} />
        ))}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My applications" />
      <ScrollView showsVerticalScrollIndicator={false}>
        {renderBody()}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ApplicationCard({ application }: { application: JobApplication }) {
  return (
    <Pressable
      style={styles.card}
      accessibilityRole="button"
      onPress={() => router.push(`/connect/networking/jobs/${encodeURIComponent(application.jobId)}`)}
    >
      <View style={styles.cardTop}>
        {application.companyLogo ? (
          <Image source={{ uri: application.companyLogo }} style={styles.logo} />
        ) : (
          <View style={[styles.logo, styles.logoFallback]}>
            <Briefcase size={18} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
          </View>
        )}
        <View style={styles.cardHead}>
          <Text style={styles.title} numberOfLines={2}>{application.jobTitle}</Text>
          <Text style={styles.company} numberOfLines={1}>{application.company}</Text>
        </View>
        <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
      </View>

      <View style={styles.statusRow}>
        <ApplicationStateBadge state={application.state} />
        <Text style={styles.updated}>Updated {timeAgo(application.updatedAt)}</Text>
      </View>

      {application.lastUpdateNote ? (
        <View style={styles.noteRow}>
          <Info size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.noteText}>{application.lastUpdateNote}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.cardPadding,
    gap: Spacing.sm,
  },
  cardTop: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  logo: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  logoFallback: { alignItems: 'center', justifyContent: 'center' },
  cardHead: { flex: 1, gap: 2 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  company: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  updated: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
});
