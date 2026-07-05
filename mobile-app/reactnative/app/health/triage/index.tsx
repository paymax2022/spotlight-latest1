import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';
import { User, Baby, Users, Check, ShieldCheck, Stethoscope } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { TriageScaffold, CautionBanner } from '@/features/triage/components';
import { useProfiles, useCreateSession } from '@/features/triage/hooks';
import { useLanguage } from '@/features/triage/useLanguage';
import { t } from '@/features/triage/i18n';
import { track } from '@/features/triage/analytics';
import type { Profile, ProfileKind } from '@/features/triage/types';

const KIND_ICON: Record<ProfileKind, typeof User> = {
  self: User,
  child: Baby,
  dependant: Users,
};

export default function TriageStartScreen() {
  const [lang, setLang] = useLanguage();
  const s = t(lang);
  const { data: profiles, isLoading, isError, refetch } = useProfiles();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [consented, setConsented] = useState(false);
  const createSession = useCreateSession();

  const selected = useMemo<Profile | undefined>(
    () => profiles?.find((p) => p.id === selectedId) ?? profiles?.[0],
    [profiles, selectedId],
  );

  const canStart = Boolean(selected) && consented;

  const onStart = () => {
    if (!canStart || !selected) return;
    createSession.mutate(
      { profileId: selected.id, language: lang, channel: 'app', consent: true },
      {
        onSuccess: (session) => {
          track('triage_started', { profileKind: selected.kind, language: lang });
          router.push({ pathname: '/health/triage/intake', params: { sessionId: session.id, profileId: selected.id } });
        },
      },
    );
  };

  return (
    <TriageScaffold title={s.appName} lang={lang} onChangeLang={setLang}>
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : isError || !profiles ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Intro / scope (SC-1) */}
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <Stethoscope size={22} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.tagline}>{s.appTagline}</Text>
          </View>

          {/* Profile picker */}
          <Text style={styles.sectionTitle}>{s.whoIsThisFor}</Text>
          <View style={styles.profileList}>
            {profiles.map((p) => {
              const active = (selected?.id ?? '') === p.id;
              const Icon = KIND_ICON[p.kind];
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setSelectedId(p.id)}
                  style={[styles.profileRow, shadow1, active && styles.profileRowActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.profileIcon, active && styles.profileIconActive]}>
                    <Icon size={20} color={active ? Colors.onPrimary : Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={styles.profileBody}>
                    <Text style={styles.profileName}>{p.name}</Text>
                    <Text style={styles.profileKind}>
                      {p.kind === 'self' ? 'Myself' : p.kind === 'child' ? 'Child' : 'Dependant'}
                      {p.isPregnant ? ' · pregnant' : ''}
                    </Text>
                  </View>
                  {active ? <Check size={20} color={Colors.primary} strokeWidth={2.5} /> : null}
                </Pressable>
              );
            })}
          </View>

          {/* SC-9 extra caution for child / maternal */}
          <View style={styles.cautionWrap}>
            <CautionBanner lang={lang} profile={selected} />
          </View>

          {/* Consent + medical-disclaimer gate (must consent before start) */}
          <Text style={styles.sectionTitle}>{s.consentTitle}</Text>
          <Pressable
            onPress={() => setConsented((c) => !c)}
            style={[styles.consent, shadow1]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consented }}
          >
            <View style={[styles.checkbox, consented && styles.checkboxOn]}>
              {consented ? <Check size={16} color={Colors.onPrimary} strokeWidth={3} /> : null}
            </View>
            <Text style={styles.consentText}>{s.consentBody}</Text>
          </Pressable>

          <View style={styles.ndpa}>
            <ShieldCheck size={14} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.ndpaText}>
              Health data is sensitive under the NDPA 2023 — encrypted, access-logged, and used only to give you this guidance.
            </Text>
          </View>
        </ScrollView>
      )}

      <View style={styles.footer}>
        <PrimaryButton
          label={s.startCheck}
          onPress={onStart}
          disabled={!canStart}
          loading={createSession.isPending}
        />
      </View>
    </TriageScaffold>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  intro: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  introIcon: {
    width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center',
  },
  tagline: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 20 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  profileList: { gap: Spacing.sm },
  profileRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.outlineVariant,
  },
  profileRowActive: { borderColor: Colors.primary },
  profileIcon: {
    width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center',
  },
  profileIconActive: { backgroundColor: Colors.primary },
  profileBody: { flex: 1 },
  profileName: { ...Typography.labelLg, color: Colors.onSurface },
  profileKind: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  cautionWrap: { marginHorizontal: -Spacing.containerMargin },
  consent: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
  },
  checkbox: {
    width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 2, borderColor: Colors.outline,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 19 },
  ndpa: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingHorizontal: Spacing.xs },
  ndpaText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 15 },
  footer: {
    padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
