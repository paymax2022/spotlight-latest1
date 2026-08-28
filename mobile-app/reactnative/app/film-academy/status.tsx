// ── Film Academy — my application ────────────────────────────────────────────
// A NATIVE screen showing the signed-in applicant their own application: where
// it stands, what happened so far, and what they must do next.
//
// The "what next" list is NOT derived here. The server returns it, so the app
// and the web console can never disagree about whether tuition is payable.
//
// Money note: every academy amount is in NAIRA, not kobo — these tables predate
// the kobo convention used across finance. Do not multiply by 100.

import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CircleCheck, Clock, CircleAlert, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { getApplicationStatus, FILM_ACADEMY_STATUS_KEY } from '@/features/filmAcademy/api';
import type { FilmAcademyAction, FilmAcademyTimelineEntry } from '@/features/filmAcademy/types';

function formatNaira(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `₦${Number(n).toLocaleString('en-NG')}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Status strings come from the database verbatim; this only affects presentation. */
function statusPresentation(status: string | null): { label: string; color: string; bg: string } {
  switch (status) {
    case 'approved':
      return { label: 'Approved', color: Colors.teal, bg: Colors.iconBgGreen };
    case 'rejected':
      return { label: 'Not successful', color: Colors.error, bg: Colors.surfaceVariant };
    case 'under_review':
      return { label: 'Under review', color: Colors.gold, bg: Colors.iconBgGold };
    case 'waitlisted':
      return { label: 'Waitlisted', color: Colors.gold, bg: Colors.iconBgGold };
    default:
      return { label: 'Submitted', color: Colors.onSurfaceVariant, bg: Colors.surfaceVariant };
  }
}

/**
 * Where each server-declared action leads in THIS app. A key with no entry
 * renders as information only — better than a tap that dead-ends on a route
 * that has not been built yet.
 */
const ACTION_ROUTES: Record<string, string> = {
  pay_application_fee: '/film-academy',
  pay_tuition: '/film-academy/tuition',
  // An overdue notice that cannot be acted on is just an accusation — it goes to
  // the same screen as a normal instalment payment.
  tuition_overdue: '/film-academy/tuition',
  start_learning: '/film-academy/learn',
};

function ActionCard({ action }: { action: FilmAcademyAction }) {
  // Only actions that actually lead somewhere are tappable. An informational
  // entry ("awaiting review") must not look like a button that does nothing.
  // The server returns no route — it serves both this app and the web console,
  // which route differently — so the destination is resolved here by key.
  const target = ACTION_ROUTES[action.key] ?? null;
  const isPayment =
    action.key === 'pay_tuition' ||
    action.key === 'pay_application_fee' ||
    action.key === 'tuition_overdue';

  const body = (
    <View style={[styles.actionCard, isPayment && styles.actionCardAccent]}>
      <View style={styles.actionIcon}>
        {isPayment
          ? <CircleAlert size={18} color={Colors.gold} />
          : <Clock size={18} color={Colors.onSurfaceVariant} />}
      </View>
      <View style={styles.actionBody}>
        <Text style={styles.actionLabel}>{action.label}</Text>
        <Text style={styles.actionDetail}>{action.detail}</Text>
        {action.amountNgn !== undefined && (
          <Text style={styles.actionAmount}>
            {formatNaira(action.amountNgn)}
            {action.dueDate ? `  ·  due ${formatDate(action.dueDate)}` : ''}
          </Text>
        )}
      </View>
      {target && <ChevronRight size={18} color={Colors.onSurfaceVariant} />}
    </View>
  );

  if (!target) return body;
  return (
    <Pressable onPress={() => router.push(target as never)} accessibilityRole="button">
      {body}
    </Pressable>
  );
}

function TimelineRow({ entry, isLast }: { entry: FilmAcademyTimelineEntry; isLast: boolean }) {
  const { label } = statusPresentation(entry.new_status);
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineGutter}>
        <View style={styles.timelineDot} />
        {!isLast && <View style={styles.timelineLine} />}
      </View>
      <View style={styles.timelineBody}>
        <Text style={styles.timelineLabel}>{label}</Text>
        {!!entry.change_reason && <Text style={styles.timelineReason}>{entry.change_reason}</Text>}
        <Text style={styles.timelineDate}>{formatDate(entry.created_at)}</Text>
      </View>
    </View>
  );
}

export default function FilmAcademyStatusScreen() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: FILM_ACADEMY_STATUS_KEY,
    queryFn: getApplicationStatus,
  });

  const application = data?.application ?? null;
  const payments = data?.payments ?? [];
  const paidCount = payments.filter((p) => p.status === 'paid').length;
  const presentation = statusPresentation(application?.status ?? null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/film-academy')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>My application</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        {isLoading && (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>Loading your application…</Text>
          </View>
        )}

        {!!error && !isLoading && (
          <View style={styles.state}>
            <Text style={styles.stateText}>Could not load your application.</Text>
            <Pressable onPress={() => refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !error && !application && (
          <View style={styles.state}>
            <FileText size={28} color={Colors.onSurfaceVariant} />
            <Text style={styles.stateText}>You have not applied to a cohort yet.</Text>
            <Pressable onPress={() => router.replace('/film-academy')} style={styles.retry}>
              <Text style={styles.retryText}>Browse cohorts</Text>
            </Pressable>
          </View>
        )}

        {!!application && (
          <>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>
                  {application.academy_batches?.batch_name ?? 'Film Academy'}
                </Text>
                <View style={[styles.pill, { backgroundColor: presentation.bg }]}>
                  <Text style={[styles.pillText, { color: presentation.color }]}>
                    {presentation.label}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardMeta}>Applied {formatDate(application.created_at)}</Text>
              {!!application.academy_batches?.start_date && (
                <Text style={styles.cardMeta}>
                  Cohort starts {formatDate(application.academy_batches.start_date)}
                </Text>
              )}
            </View>

            {(data?.actions.length ?? 0) > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>What happens next</Text>
                {data!.actions.map((a) => <ActionCard key={a.key} action={a} />)}
              </View>
            )}

            {/* Tuition is shown once a plan exists — i.e. only after approval.
                Before that the applicant has paid the application fee only, and
                showing a payable-looking tuition figure would misrepresent it. */}
            {!!data?.plan && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Tuition</Text>
                <View style={styles.card}>
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>Total tuition</Text>
                    <Text style={styles.feeValue}>
                      {formatNaira(data.plan.discounted_amount_ngn ?? data.plan.total_amount_ngn)}
                    </Text>
                  </View>
                  <Text style={styles.cardMeta}>
                    {paidCount} of {payments.length} instalment{payments.length === 1 ? '' : 's'} paid
                  </Text>
                  {payments.map((p) => (
                    <View key={p.id} style={styles.instalmentRow}>
                      {p.status === 'paid'
                        ? <CircleCheck size={16} color={Colors.teal} />
                        : <Clock size={16} color={Colors.onSurfaceVariant} />}
                      <Text style={styles.instalmentLabel}>
                        Instalment {p.installment_number}
                      </Text>
                      <Text style={styles.instalmentMeta}>
                        {p.status === 'paid' ? `Paid ${formatDate(p.paid_at)}` : `Due ${formatDate(p.due_date)}`}
                      </Text>
                      <Text style={styles.instalmentAmount}>{formatNaira(p.amount_ngn)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {(data?.timeline.length ?? 0) > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Progress</Text>
                <View style={styles.card}>
                  {data!.timeline.map((entry, i) => (
                    <TimelineRow
                      key={entry.id}
                      entry={entry}
                      isLast={i === data!.timeline.length - 1}
                    />
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  back:        { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll:      { padding: Spacing.containerMargin, paddingBottom: Spacing.xl * 2, gap: Spacing.md },

  state:       { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  stateText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  retry:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
                 borderRadius: Radius.md, backgroundColor: Colors.surfaceVariant },
  retryText:   { ...Typography.labelLg, color: Colors.onSurface },

  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs },
  cardHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  cardMeta:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  pill:        { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm },
  pillText:    { ...Typography.labelSm },

  section:     { gap: Spacing.sm },
  sectionTitle:{ ...Typography.labelMd, color: Colors.onSurfaceVariant },

  actionCard:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg },
  actionCardAccent: { borderWidth: 1, borderColor: Colors.gold },
  actionIcon:  { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center',
                 justifyContent: 'center', backgroundColor: Colors.surfaceVariant },
  actionBody:  { flex: 1, gap: 2 },
  actionLabel: { ...Typography.labelLg, color: Colors.onSurface },
  actionDetail:{ ...Typography.bodySm, color: Colors.onSurfaceVariant },
  actionAmount:{ ...Typography.labelLg, color: Colors.gold, marginTop: 2 },

  feeRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feeLabel:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  feeValue:    { ...Typography.titleMd, color: Colors.onSurface },

  instalmentRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm },
  instalmentLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  instalmentMeta:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  instalmentAmount:{ ...Typography.labelLg, color: Colors.onSurface },

  timelineRow:    { flexDirection: 'row', gap: Spacing.sm },
  timelineGutter: { width: 16, alignItems: 'center' },
  timelineDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.gold, marginTop: 5 },
  timelineLine:   { flex: 1, width: 2, backgroundColor: Colors.surfaceVariant, marginVertical: 2 },
  timelineBody:   { flex: 1, paddingBottom: Spacing.md, gap: 2 },
  timelineLabel:  { ...Typography.labelLg, color: Colors.onSurface },
  timelineReason: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  timelineDate:   { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
