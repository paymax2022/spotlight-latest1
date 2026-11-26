import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X, CheckCircle2, Circle } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import {
  getEditionRules, getEditionRulesBySlug, acceptEditionRulesBySlug,
} from '@/features/voting/api/edition.api';
import type { EditionRules } from '@/features/voting/types/edition.types';

// The dedicated RULES & REGULATIONS page for a Rising Star edition (§5). Shows
// the published rules version, its publication date and the full structured
// content. Opened two ways:
//   • from contest-details with `contestId` → read-only rules view;
//   • from the registration submit screen with `slug` + `applicationId` → the
//     affirmative acceptance gate: registration cannot complete until the box is
//     ticked, and ticking it records the exact rules version the authenticated
//     user accepted (keyed on user + edition + version, never a contestants row,
//     which does not exist until the application is approved).
const SECTION_TITLES: Record<string, string> = {
  general: 'General Contest Information',
  eligibility: 'Eligibility Criteria',
  registration: 'Registration Rules',
  participation: 'Participation Rules',
  selection: 'Winner Selection Methodology',
  prizes: 'Prizes & Awards',
  disqualification: 'Disqualification & Disputes',
  media: 'Media & Promotional Rights',
  terms: 'General Terms',
};

export default function EditionRulesScreen() {
  const { contestId, slug, applicationId, contestTitle } = useLocalSearchParams<{
    contestId?: string; slug?: string; applicationId?: string; contestTitle?: string;
  }>();
  const [rules, setRules] = useState<EditionRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = slug ? getEditionRulesBySlug(slug) : getEditionRules(contestId ?? '');
    void load.then((r) => { if (alive) { setRules(r); setLoading(false); } });
    return () => { alive = false; };
  }, [contestId, slug]);

  // The acceptance gate is only offered on the registration path, where we have a
  // slug to resolve the edition and an application to capture the gate against.
  const needsAcceptance = !!slug && !!applicationId;

  async function onAccept() {
    if (!rules || !slug || !applicationId) return;
    setSaving(true); setError('');
    try {
      await acceptEditionRulesBySlug(slug, applicationId, rules.id);
      // Return to the submit screen so the applicant can complete registration.
      if (router.canGoBack()) router.back();
      else goBack(`/registration/${applicationId}/submit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record acceptance');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Rules & Regulations</Text>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : goBack('/voting'))} style={styles.closeBtn}>
          <X size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={Colors.primary} />
        ) : !rules ? (
          <Text style={styles.empty}>Rules for this edition have not been published yet.</Text>
        ) : (
          <>
            <Text style={styles.edition}>{contestTitle || 'Spotlight Rising Star'}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>Version {rules.version}</Text>
              {rules.published_at && <Text style={styles.meta}>Published {new Date(rules.published_at).toLocaleDateString()}</Text>}
              {rules.effective_date && <Text style={styles.meta}>Effective {new Date(rules.effective_date).toLocaleDateString()}</Text>}
            </View>

            {Object.entries(SECTION_TITLES).map(([key, heading]) => {
              const body = rules.content?.[key];
              if (body == null || body === '') return null;
              return (
                <View key={key} style={styles.section}>
                  <Text style={styles.sectionTitle}>{heading}</Text>
                  <Text style={styles.sectionBody}>{typeof body === 'string' ? body : JSON.stringify(body, null, 2)}</Text>
                </View>
              );
            })}

            {needsAcceptance && (
              <View style={styles.acceptBox}>
                <Pressable style={styles.acceptRow} onPress={() => setAccepted((a) => !a)} disabled={saving}>
                  {accepted
                    ? <CheckCircle2 size={22} color={Colors.primary} />
                    : <Circle size={22} color={Colors.onSurfaceVariant} />}
                  <Text style={styles.acceptText}>
                    I have read, understood and agree to the Spotlight Rising Star contest rules and regulations for this edition.
                  </Text>
                </Pressable>
                {!!error && <Text style={styles.error}>{error}</Text>}
                <PrimaryButton label="Accept & continue registration" onPress={onAccept} disabled={!accepted || saving} />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  closeBtn: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 60 },
  empty: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  edition: { ...Typography.titleMd, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  section: { gap: 4 },
  sectionTitle: { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' },
  sectionBody: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 22 },
  acceptBox: { marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.md, backgroundColor: Colors.surface },
  acceptRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  acceptText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 20 },
  error: { ...Typography.bodySm, color: '#ea5455' },
});
