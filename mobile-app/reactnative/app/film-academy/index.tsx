// tile must never hand the user to a browser. This calls the same
// /api/academy/* endpoints the web console uses — sharing an API is fine.
// Money note: academy amounts are NAIRA, not kobo — these tables predate the
// kobo convention used across finance. Tuition is the composite format
// structure served per training (academy_area_pricing_options): weekend /
// weekdays, each with and without boarding, plus a 30-day full-time boarding
// format. The settings.tuition_fee programme figure is never charged.

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronDown, Clapperboard, CalendarDays, Check, Clock, FileText, GraduationCap, ClipboardList, Layers, Award } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { getOverview } from '@/features/filmAcademy/api';
import type { FilmAcademyBatch, FilmAcademyInterestArea, FilmAcademyOverview } from '@/features/filmAcademy/types';
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

/** Cheapest format price for a training — the composite structure, not the retired fee_ngn. */
function fromPrice(area: FilmAcademyInterestArea): number {
  const opts = area.pricing_options ?? [];
  if (opts.length > 0) return Math.min(...opts.map((o) => Number(o.price_ngn)));
  return Number(area.fee_ngn ?? 0); // older server without the format table
}

function TuitionStructureCard({ data }: { data: FilmAcademyOverview }) {
  const structure = data.pricingStructure;
  if (structure.length === 0) return null;
  // Deliberately no area list here: every training is shown inside its own
  // batch below, with its five price lines in the accordion. A standalone
  // catalogue outside the batches went stale whenever a batch stopped offering
  // one of these trainings.
  return (
    <View style={styles.card}>
      {data.deliverables.length > 0 && (
        <>
          <Text style={styles.trainingsTitle}>Your tuition includes</Text>
          {data.deliverables.map((d) => (
            <Text key={d} style={styles.trainingMeta}>• {d}</Text>
          ))}
        </>
      )}
      {data.feeExclusions.length > 0 && (
        <>
          <Text style={styles.trainingsTitle}>Fees exclude</Text>
          {data.feeExclusions.map((d) => (
            <Text key={d} style={styles.trainingMeta}>• {d}</Text>
          ))}
        </>
      )}
      <Text style={styles.feeNote}>
        You pay the application fee and first tuition payment together when you apply. Open a training in a
        cohort below and tap its price line to choose, then continue to apply.
      </Text>
    </View>
  );
}

function BatchCard({ batch, areas, applied }: {
  batch: FilmAcademyBatch; areas: FilmAcademyInterestArea[]; applied: boolean;
}) {
  // Accordion selection: { areaSlug: formatKey }. Tapping a training opens it;
  // tapping one of its price lines selects the training IN that format (the
  // tuition the apply form and the server then carry). A legacy area with no
  // format table is selected by its header directly, under the empty key.
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const selectedSlugs = Object.keys(selections);
  const selected = areas.filter((area) => area.slug in selections);

  const chosenFee = (area: FilmAcademyInterestArea) => {
    const key = selections[area.slug];
    const opt = (area.pricing_options ?? []).find((o) => o.key === key);
    return opt ? Number(opt.price_ngn) : fromPrice(area);
  };
  const totalSelectedFee = selected.reduce((sum, area) => sum + chosenFee(area), 0);

  const pickSub = (area: FilmAcademyInterestArea, key: string) =>
    setSelections((prev) => {
      if (prev[area.slug] === key) {
        const next = { ...prev };
        delete next[area.slug];
        return next;
      }
      if (!(area.slug in prev) && Object.keys(prev).length >= 2) return prev;
      return { ...prev, [area.slug]: key };
    });

  const toggleArea = (area: FilmAcademyInterestArea) =>
    setSelections((prev) => {
      if (area.slug in prev) {
        const next = { ...prev };
        delete next[area.slug];
        return next;
      }
      if (Object.keys(prev).length >= 2) return prev;
      return { ...prev, [area.slug]: '' };
    });

  const apply = () => {
    const query = new URLSearchParams({ batchId: batch.id });
    if (selectedSlugs.length > 0) {
      query.set('area', selectedSlugs.join(','));
      const pairs = selectedSlugs.filter((s) => selections[s]).map((s) => `${s}:${selections[s]}`);
      if (pairs.length > 0) query.set('formats', pairs.join(','));
    }
    router.push(`/film-academy/apply?${query.toString()}` as never);
  };

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

      <Text style={styles.trainingsTitle}>Choose a training</Text>
      {areas.length === 0 ? (
        <Text style={styles.feeNote}>
          This cohort has no trainings configured yet — applications are closed
          until the academy team sets them. Check back soon.
        </Text>
      ) : (
        <View style={styles.trainings}>
          {areas.map((area) => {
            const chosenKey = selections[area.slug];
            const on = chosenKey !== undefined;
            const hasFormats = (area.pricing_options?.length ?? 0) > 0;
            const isOpen = openSlug === area.slug;
            const chosenOpt = hasFormats
              ? (area.pricing_options ?? []).find((o) => o.key === chosenKey)
              : undefined;
            return (
              <View key={area.slug} style={[styles.trainingGroup, on && styles.trainingRowOn]}>
                <Pressable
                  onPress={() => (hasFormats
                    ? setOpenSlug(isOpen ? null : area.slug)
                    : toggleArea(area))}
                  disabled={applied || (!hasFormats && !on && selectedSlugs.length >= 2)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: hasFormats && isOpen, selected: on, disabled: applied }}
                  accessibilityLabel={chosenOpt
                    ? `${area.label}, ${chosenOpt.label} selected`
                    : `${area.label}${on ? ', selected' : ', tap to open its price lines'}`}
                  style={styles.trainingRow}
                >
                  {!hasFormats && (
                    <View style={[styles.trainingCheck, on && styles.trainingCheckOn]}>
                      {on && <Check size={13} color={Colors.black} />}
                    </View>
                  )}
                  <View style={styles.trainingBody}>
                    <Text style={[styles.trainingLabel, on && styles.trainingLabelOn]}>{area.label}</Text>
                    {chosenOpt ? (
                      <Text style={styles.trainingMeta}>
                        {chosenOpt.label} — {formatNaira(Number(chosenOpt.price_ngn))}
                      </Text>
                    ) : (
                      <>
                        {!!area.description && (
                          <Text style={styles.trainingMeta} numberOfLines={2}>{area.description}</Text>
                        )}
                        {hasFormats && (
                          <Text style={styles.trainingMeta}>Tap to see the price options</Text>
                        )}
                      </>
                    )}
                  </View>
                  {hasFormats ? (
                    <ChevronDown
                      size={18}
                      color={Colors.onSurfaceVariant}
                      style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}
                    />
                  ) : (
                    <Text style={[styles.trainingFee, on && styles.trainingFeeOn]}>
                      {fromPrice(area) > 0 ? formatNaira(fromPrice(area)) : 'No tuition'}
                    </Text>
                  )}
                </Pressable>
                {isOpen && hasFormats && (
                  <View style={styles.subs}>
                    {(area.pricing_options ?? []).map((o) => {
                      const subOn = chosenKey === o.key;
                      const blocked = !subOn && !on && selectedSlugs.length >= 2;
                      return (
                        <Pressable
                          key={o.key}
                          onPress={() => pickSub(area, o.key)}
                          disabled={applied || blocked}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: subOn, disabled: applied || blocked }}
                          accessibilityLabel={`${o.label}${o.note ? `, ${o.note}` : ''}, ₦${Number(o.price_ngn).toLocaleString('en-NG')}`}
                          style={[styles.subRow, subOn && styles.trainingRowOn, blocked && styles.chipBlocked]}
                        >
                          {subOn
                            ? <Check size={14} color={Colors.primary} />
                            : <View style={styles.subSpacer} />}
                          <Text style={[styles.trainingLabel, subOn && styles.trainingLabelOn]}>
                            {o.label}{o.note ? ` (${o.note})` : ''}
                          </Text>
                          <Text style={[styles.trainingFee, subOn && styles.trainingFeeOn]}>
                            = {formatNaira(Number(o.price_ngn))}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {!!batch.installments_count && batch.installments_count > 1 && totalSelectedFee > 0 && (
        <Text style={styles.feeNote}>
          Payable in {batch.installments_count} instalments
          {batch.fee_frequency ? ` (${batch.fee_frequency})` : ''}
        </Text>
      )}

      {selected.length > 0 && (
        <View style={styles.selectedRow}>
          <Text style={styles.selectedLabel}>Selected training</Text>
          <Text style={styles.selectedValue}>
            {selected.map(s => s.label).join(', ')} · {totalSelectedFee > 0 ? `tuition ${formatNaira(totalSelectedFee)}` : 'No tuition'}
          </Text>
        </View>
      )}

      <Pressable
        style={[styles.applyBtn, (applied || (areas.length > 0 && selected.length === 0)) && styles.applyBtnDone]}
        disabled={applied || (areas.length > 0 && selected.length === 0)}
        onPress={apply}
      >
        <Text style={[styles.applyText, (applied || (areas.length > 0 && selected.length === 0)) && styles.applyTextDone]}>
          {applied
            ? 'Application submitted'
            : areas.length === 0
              ? 'Apply to this cohort'
              : selected.length > 0
                ? `Apply for ${selected.length} training${selected.length > 1 ? 's' : ''}`
                : 'Select a training above'}
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
  const catalogue = data?.interestAreas ?? [];

  // A batch offers EXACTLY its linked trainings — an empty entry means it has
  // none set yet. Only a batchAreas map without this batch's key at all (an
  // older server) falls back to the full catalogue.
  const areasFor = (batchId: string): FilmAcademyInterestArea[] => {
    const offered = data?.batchAreas?.[batchId];
    return offered === undefined
      ? catalogue
      : catalogue.filter((area) => offered.includes(area.slug));
  };

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

        <View style={styles.heroBanner}>
          <Image
            source={{ uri: 'https://res.cloudinary.com/paymax/image/upload/v1792924527/Royal_Purple_Film_Academy_Hero_Banner_eahntm.png' }}
            style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
            resizeMode="cover"
            accessibilityLabel="Film Academy"
          />
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

            <Pressable onPress={() => router.push('/film-academy/path')} style={styles.trackRow}>
              <View style={styles.trackIcon}>
                <Layers size={18} color={Colors.gold} />
              </View>
              <View style={styles.trackBody}>
                <Text style={styles.trackLabel}>Topic path</Text>
                <Text style={styles.trackMeta}>Master each topic at 85% to unlock the next</Text>
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

            <Pressable onPress={() => router.push('/film-academy/certificate')} style={styles.trackRow}>
              <View style={styles.trackIcon}>
                <Award size={18} color={Colors.gold} />
              </View>
              <View style={styles.trackBody}>
                <Text style={styles.trackLabel}>Certificate</Text>
                <Text style={styles.trackMeta}>Your verifiable TMFA credential and what still blocks it</Text>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} />
            </Pressable>
          </>
        )}

        {/* Same five formats price every training — shown once, here, so the
            cohort cards below can stay about choosing one. */}
        {!!data && !isLoading && !error && data.interestAreas.length > 0 && (
          <TuitionStructureCard data={data} />
        )}

        {batches.map((b) => (
          <BatchCard
            key={b.id}
            batch={b}
            areas={areasFor(b.id)}
            applied={applied.has(b.id)}
          />
        ))}
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
  heroBanner:  { aspectRatio: 2, borderRadius: Radius.lg, overflow: 'hidden', marginBottom: Spacing.md },
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
  trainingsTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  trainingGroup: { gap: 0 },
  subs: { paddingLeft: Spacing.sm, paddingBottom: Spacing.xs, gap: 2 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
            paddingHorizontal: Spacing.sm, paddingVertical: 10, borderRadius: Radius.md },
  subSpacer: { width: 14 },
  chipBlocked: { opacity: 0.35 },
  trainings:   { gap: 6 },
  trainingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
                 borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 10 },
  trainingRowOn: { borderColor: Colors.gold, backgroundColor: Colors.iconBgGold },
  trainingCheck: { width: 18, height: 18, borderRadius: 9, borderWidth: 1,
                   borderColor: Colors.onSurfaceVariant, alignItems: 'center', justifyContent: 'center' },
  trainingCheckOn: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  trainingBody: { flex: 1, gap: 1 },
  trainingLabel: { ...Typography.labelMd, color: Colors.onSurface },
  trainingLabelOn: { color: Colors.onSurface },
  trainingMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  trainingFee: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  trainingFeeOn: { color: Colors.onSurface },
  selectedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                 gap: Spacing.sm, marginTop: Spacing.xs },
  selectedLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  selectedValue: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
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
