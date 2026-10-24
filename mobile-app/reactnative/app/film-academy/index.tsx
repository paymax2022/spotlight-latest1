// tile must never hand the user to a browser. This calls the same
// /api/academy/* endpoints the web console uses — sharing an API is fine.
// Money note: academy fees (application fee, per-area tuition) are NAIRA, not kobo. The
// academy tables predate the kobo convention used across finance, so they are formatted as-is.

import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clapperboard, CalendarDays, Clock, FileText, GraduationCap, ClipboardList } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { getOverview } from '@/features/filmAcademy/api';
import type { FilmAcademyBatch, FilmAcademyInterestArea } from '@/features/filmAcademy/types';
import { areaPriceCaption } from '@/features/filmAcademy/picks';
import { HomeMenuButton } from '@/components/HomeMenu';
import { RemoteBanner } from '@/features/media/banners';

export const FILM_ACADEMY_KEY = ['film-academy', 'overview'];

function formatNaira(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return `₦${Number(n).toLocaleString('en-NG')}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Date to be announced';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date to be announced';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function BatchCard({ batch, applied, areas, maxAreas, applicationFee, areaOptionsEnabled }: {
  batch: FilmAcademyBatch; applied: boolean;
  areas: FilmAcademyInterestArea[]; maxAreas: number; applicationFee: number;
  /** Off: area labels only — no "from ₦X" / "Pricing coming soon". */
  areaOptionsEnabled: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{batch.batch_name}</Text>
        {applied && (
          <View style={styles.appliedPill}>
            <Text style={styles.appliedText}>Applied</Text>
          </View>
        )}
      </View>

      {!!batch.description && <Text style={styles.cardDesc}>{batch.description}</Text>}

      <View style={styles.metaRow}>
        <CalendarDays size={14} color={Colors.onSurfaceVariant} />
        <Text style={styles.metaText}>Starts {formatDate(batch.start_date)}</Text>
      </View>
      {!!batch.duration_weeks && (
        <View style={styles.metaRow}>
          <Clock size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.metaText}>
            {batch.duration_weeks} weeks{batch.training_schedule ? ` · ${batch.training_schedule}` : ''}
          </Text>
        </View>
      )}

      {areas.length > 0 && (
        <View style={styles.areasBlock}>
          <Text style={styles.areasLabel}>Areas of interest · choose up to {maxAreas}</Text>
          {/* Informational here: options are chosen on the apply screen. */}
          <View style={styles.areaGrid}>
            {areas.map((a) => {
              const caption = areaPriceCaption(a, areaOptionsEnabled);
              return (
                <View
                  key={a.slug}
                  style={[styles.areaCard, caption.kind === 'soon' && styles.areaCardOff]}
                  accessible
                  accessibilityLabel={caption.kind === 'soon'
                    ? `${a.label}, pricing coming soon`
                    : caption.kind === 'from'
                      ? `${a.label}, from ${formatNaira(caption.price)}`
                      : a.label}
                >
                  <Text style={styles.areaLabel}>{a.label}</Text>
                  {caption.kind === 'soon' && <Text style={styles.areaSoon}>Pricing coming soon</Text>}
                  {caption.kind === 'from' && (
                    <Text style={styles.areaFrom}>from {formatNaira(caption.price)}</Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      )}

      {applicationFee > 0 && (
        <View style={styles.feeRow}>
          <Text style={styles.feeLabel}>Application fee</Text>
          <Text style={styles.feeValue}>{formatNaira(applicationFee)}</Text>
        </View>
      )}
      {/* No tuition total here: tuition depends on the option and boarding chosen
          per area, which happens on the apply screen. */}
      {!!batch.installments_count && batch.installments_count > 1 && (
        <Text style={styles.feeNote}>
          Payable in {batch.installments_count} instalments
          {batch.fee_frequency ? ` (${batch.fee_frequency})` : ''}
        </Text>
      )}

      <Pressable
        style={[styles.applyBtn, applied && styles.applyBtnDone]}
        disabled={applied}
        onPress={() => router.push(`/film-academy/apply?batchId=${batch.id}` as never)}
      >
        <Text style={[styles.applyText, applied && styles.applyTextDone]}>
          {applied ? 'Application submitted' : 'Apply to this cohort'}
        </Text>
      </Pressable>
    </View>
  );
}

export default function FilmAcademyScreen() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: FILM_ACADEMY_KEY,
    queryFn: getOverview,
  });

  const batches = data?.batches ?? [];
  const applied = new Set(data?.appliedBatchIds ?? []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Film Academy</Text>
        <HomeMenuButton />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <RemoteBanner slug="film-academy" priority />

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Clapperboard size={26} color={Colors.gold} />
          </View>
          <Text style={styles.heroTitle}>Learn filmmaking, hands on</Text>
          <Text style={styles.heroSub}>
            Structured cohorts covering production craft, taught on a fixed schedule.
            Choose a cohort below to apply.
          </Text>
        </View>

        {isLoading && (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>Loading cohorts…</Text>
          </View>
        )}

        {!!error && !isLoading && (
          <View style={styles.state}>
            <Text style={styles.stateText}>Could not load cohorts.</Text>
            <Pressable onPress={() => refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !error && batches.length === 0 && (
          <View style={styles.state}>
            <Text style={styles.stateText}>
              No cohorts are open right now. Check back soon.
            </Text>
          </View>
        )}

        {/* Applicants land back here from the service tile, so the way into their
            own application has to be on this screen. Shown only once they have
            actually applied — an empty tracker is worse than no tracker. */}
        {applied.size > 0 && (
          <Pressable onPress={() => router.push('/film-academy/status')} style={styles.trackRow}>
            <View style={styles.trackIcon}>
              <FileText size={18} color={Colors.gold} />
            </View>
            <View style={styles.trackBody}>
              <Text style={styles.trackLabel}>My application</Text>
              <Text style={styles.trackMeta}>Track status, next steps and tuition</Text>
            </View>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </Pressable>
        )}

        {/* Both open for anyone who has applied. Each screen resolves its own
            locked state from the server and explains what is still outstanding,
            which beats hiding the tile and leaving the learner guessing. */}
        {applied.size > 0 && (
          <>
            <Pressable onPress={() => router.push('/film-academy/learn')} style={styles.trackRow}>
              <View style={styles.trackIcon}>
                <GraduationCap size={18} color={Colors.gold} />
              </View>
              <View style={styles.trackBody}>
                <Text style={styles.trackLabel}>My course</Text>
                <Text style={styles.trackMeta}>Lessons, modules and your progress</Text>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} />
            </Pressable>

            <Pressable onPress={() => router.push('/film-academy/assignments')} style={styles.trackRow}>
              <View style={styles.trackIcon}>
                <ClipboardList size={18} color={Colors.gold} />
              </View>
              <View style={styles.trackBody}>
                <Text style={styles.trackLabel}>Assignments</Text>
                <Text style={styles.trackMeta}>Submit your work and see your grades</Text>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} />
            </Pressable>
          </>
        )}

        {batches.map((b) => {
          // A batch absent from batchAreas (or with an empty list) offers every
          // active area — same rule apply.tsx uses, so the card matches the form.
          const offered = data?.batchAreas?.[b.id] ?? [];
          const all = data?.interestAreas ?? [];
          const areas = offered.length > 0 ? all.filter((a) => offered.includes(a.slug)) : all;
          return (
          <BatchCard
            key={b.id}
            batch={b}
            areas={areas}
            maxAreas={data?.maxInterestAreas ?? 2}
            areaOptionsEnabled={data?.areaOptionsEnabled === true}
            applicationFee={String(data?.settings?.registration_type ?? '').toLowerCase() === 'paid'
              ? Number(data?.settings?.application_fee ?? 0) : 0}
            applied={applied.has(b.id)}
          />
          );
        })}
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
  hero:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs },
  heroIcon:    { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.iconBgGold,
                 alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle:   { ...Typography.headlineMd, color: Colors.onSurface },
  heroSub:     { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  trackRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg },
  trackIcon:   { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center',
                 justifyContent: 'center', backgroundColor: Colors.iconBgGold },
  trackBody:   { flex: 1, gap: 2 },
  trackLabel:  { ...Typography.labelLg, color: Colors.onSurface },
  trackMeta:   { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs },
  cardHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  appliedPill: { backgroundColor: Colors.iconBgGreen, borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  appliedText: { ...Typography.caption, color: Colors.teal },
  cardDesc:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  feeRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                 marginTop: Spacing.sm },
  feeLabel:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  feeValue:    { ...Typography.titleMd, color: Colors.onSurface },
  areasBlock:  { marginTop: Spacing.sm, gap: Spacing.xs },
  areasLabel:  { ...Typography.labelLg, color: Colors.onSurface },
  areaGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  // Two per row from 360dp; long labels wrap inside the card rather than clip.
  areaCard:    { flexGrow: 1, flexBasis: '45%', minHeight: 56, gap: 2, justifyContent: 'center',
                 backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md,
                 borderWidth: 1, borderColor: Colors.outlineVariant,
                 paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  areaCardOff: { backgroundColor: Colors.surfaceContainerLow },
  areaLabel:   { ...Typography.labelMd, color: Colors.onSurface },
  areaFrom:    { ...Typography.bodySm, color: Colors.secondary },
  areaSoon:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  feeNote:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  applyBtn:    { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 12,
                 alignItems: 'center', marginTop: Spacing.sm },
  applyBtnDone:{ backgroundColor: Colors.surfaceContainerHigh },
  applyText:   { ...Typography.labelLg, color: '#FFFFFF' },
  applyTextDone:{ color: Colors.onSurfaceVariant },
  state:       { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  stateText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  retry:       { paddingHorizontal: Spacing.lg, paddingVertical: 8, borderRadius: Radius.md,
                 backgroundColor: Colors.surfaceContainerHigh },
  retryText:   { ...Typography.labelLg, color: Colors.onSurface },
});
