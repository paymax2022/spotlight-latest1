import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Info, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { TriageScaffold, CautionBanner } from '@/features/triage/components';
import { useSession, useProfiles, useCreateReferral } from '@/features/triage/hooks';
import { useLanguage } from '@/features/triage/useLanguage';
import { t } from '@/features/triage/i18n';
import { track } from '@/features/triage/analytics';
import { DISPOSITION_META, CARE_ROUTE_META, isEmergencyLevel } from '@/features/triage/constants';

export default function TriageResultScreen() {
  const params = useLocalSearchParams<{ sessionId?: string; profileId?: string }>();
  const sessionId = params.sessionId;
  const [lang, setLang] = useLanguage();
  const s = t(lang);
  const { data: result, isLoading, isError, refetch } = useSession(sessionId);
  const { data: profiles } = useProfiles();
  const profile = profiles?.find((p) => p.id === params.profileId);
  const referral = useCreateReferral(sessionId);

  useEffect(() => {
    if (!result) return;
    track('disposition_given', { level: result.dispositionLevel, code: result.dispositionCode });
    // SC-2/SC-8: level 1/2 or red-flag escalate to the emergency screen.
    if (result.redFlag || isEmergencyLevel(result.dispositionLevel)) {
      router.replace({ pathname: '/health/triage/emergency', params: { sessionId } });
    }
  }, [result, sessionId]);

  const onGetCare = () => {
    if (!result || !sessionId) return;
    referral.mutate(
      { level: result.dispositionLevel },
      {
        onSuccess: (ref) => {
          if (ref.route === 'self_care') {
            router.push({ pathname: '/health/triage/saved', params: { sessionId } });
            return;
          }
          if (ref.amountKobo > 0) {
            // Paid care route → reuse the shared wallet checkout on the next screen.
            router.push({
              pathname: '/health/triage/checkout',
              params: {
                sessionId,
                referralId: ref.referralId,
                route: ref.route,
                amountKobo: String(ref.amountKobo),
              },
            });
          } else {
            // Free hand-off (e.g. nearest facility) — go straight to the destination.
            const href = CARE_ROUTE_META[ref.route].href;
            router.push(href as never);
          }
        },
      },
    );
  };

  if (isLoading || !result) {
    return (
      <TriageScaffold title={s.resultTitle} lang={lang} onChangeLang={setLang} sessionId={sessionId}>
        {isError ? (
          <StateView kind="error" title="Couldn't load result" actionLabel="Retry" onAction={refetch} />
        ) : (
          <StateView kind="loading" message="Working out what to do next…" />
        )}
      </TriageScaffold>
    );
  }

  const meta = DISPOSITION_META[result.dispositionLevel];
  const routeMeta = CARE_ROUTE_META[result.recommendedRoute];
  const RouteIcon = (Icons as unknown as Record<string, Icons.LucideIcon>)[routeMeta.icon] ?? Icons.Activity;
  const isSelfCare = result.recommendedRoute === 'self_care';

  return (
    <TriageScaffold title={s.resultTitle} lang={lang} onChangeLang={setLang} sessionId={sessionId}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CautionBanner lang={lang} profile={profile} />

        {/* Urgency banner */}
        <View style={[styles.banner, { backgroundColor: meta.bg }]}>
          <Text style={[styles.bannerLevel, { color: meta.color }]}>Level {result.dispositionLevel} of 5</Text>
          <Text style={[styles.bannerLabel, { color: meta.color }]}>{meta.label}</Text>
          <Text style={styles.bannerSub}>{meta.sub}</Text>
        </View>

        {/* Possible causes (SC-1 — explicit "not a diagnosis") */}
        <Text style={styles.sectionTitle}>{s.possibleCauses}</Text>
        <View style={styles.notDx}>
          <Info size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.notDxText}>{s.notADiagnosis}</Text>
        </View>
        <View style={[styles.causes, shadow1]}>
          {result.possibleCauses.map((c, i) => (
            <View key={i} style={[styles.causeRow, i > 0 && styles.causeRowBordered]}>
              <Text style={styles.causeLabel}>{c.label}</Text>
              <View style={styles.causeBarTrack}>
                <View style={[styles.causeBarFill, { width: `${Math.round(c.probability * 100)}%` }]} />
              </View>
            </View>
          ))}
        </View>

        {/* What to do next */}
        <Text style={styles.sectionTitle}>{s.whatToDoNext}</Text>
        <View style={[styles.guidance, shadow1]}>
          <Text style={styles.guidanceText}>{result.guidance}</Text>
        </View>

        {/* Recommended care route */}
        <Text style={styles.sectionTitle}>{isSelfCare ? s.selfCareTitle : s.careOptions}</Text>
        <View style={[styles.routeCard, shadow1]}>
          <View style={[styles.routeIcon, { backgroundColor: Colors.iconBgPurple }]}>
            <RouteIcon size={22} color={routeMeta.color} strokeWidth={2} />
          </View>
          <View style={styles.routeBody}>
            <Text style={styles.routeLabel}>{routeMeta.label}</Text>
            <Text style={styles.routeCta}>{routeMeta.cta}</Text>
          </View>
          <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
        </View>

        {/* Save link */}
        <Pressable onPress={() => router.push({ pathname: '/health/triage/saved', params: { sessionId } })} hitSlop={8}>
          <Text style={styles.saveLink}>{s.saveToRecords}</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={routeMeta.cta} onPress={onGetCare} loading={referral.isPending} />
      </View>
    </TriageScaffold>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  banner: { borderRadius: Radius.lg, padding: Spacing.md, gap: 2 },
  bannerLevel: { ...Typography.labelSm },
  bannerLabel: { ...Typography.titleLg },
  bannerSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  notDx: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, paddingHorizontal: Spacing.xs },
  notDxText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 19, fontStyle: 'italic' },
  causes: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  causeRow: { gap: Spacing.xs, paddingVertical: Spacing.sm },
  causeRowBordered: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  causeLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  causeBarTrack: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainer, overflow: 'hidden' },
  causeBarFill: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.primary },
  guidance: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  guidanceText: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 22 },
  routeCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
  },
  routeIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  routeBody: { flex: 1 },
  routeLabel: { ...Typography.labelLg, color: Colors.onSurface },
  routeCta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  saveLink: { ...Typography.labelMd, color: Colors.secondary, textAlign: 'center', paddingVertical: Spacing.sm },
  footer: {
    padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
