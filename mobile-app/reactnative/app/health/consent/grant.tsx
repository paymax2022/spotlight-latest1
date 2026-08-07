import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Check, ShieldCheck, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useSubjects, useProviders, useGrantConsent } from '@/features/health/hooks';
import {
  VERTICAL_META,
  CONSENT_SCOPE_OPTIONS,
  NDPA_CONSENT_COPY,
} from '@/features/health/constants/health.constants';
import { alertAsync } from '@/lib/confirm';
import type { ConsentScope } from '@/features/health/types';

/**
 * Grant a new cross-vertical share (HL-8): pick subject (patient/pet), grantee
 * (verified provider) and the granular scopes. Consent is surfaced explicitly.
 */
export default function GrantConsentScreen() {
  const { data: subjects } = useSubjects();
  const { data: providers } = useProviders();
  const grant = useGrantConsent();

  const [subjectId, setSubjectId] = useState<string>('');
  const [granteeId, setGranteeId] = useState<string>('');
  const [scopes, setScopes] = useState<ConsentScope[]>([]);

  const eligible = useMemo(() => providers ?? [], [providers]);

  const toggleScope = (scope: ConsentScope) => {
    if (scope === 'all') {
      setScopes((prev) => (prev.includes('all') ? [] : ['all']));
      return;
    }
    setScopes((prev) => {
      const next = prev.filter((s) => s !== 'all');
      return next.includes(scope) ? next.filter((s) => s !== scope) : [...next, scope];
    });
  };

  const canSubmit = subjectId && granteeId && scopes.length > 0;

  const onGrant = () => {
    if (!canSubmit) return;
    grant.mutate(
      {
        subjectId,
        granteeId,
        granteeVertical: eligible.find((p) => p.id === granteeId)!.vertical,
        scopes,
      },
      {
        onSuccess: () => {
          alertAsync({ title: 'Access granted', message: 'A revocable consent grant was created.', buttonLabel: 'Done' }).then(() => router.back());
        },
        onError: () => alertAsync({ title: 'Could not grant', message: 'Please try again.' }),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Grant access"
        showBack={false}
        rightSlot={
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Close">
            <X size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Subject */}
        <Text style={styles.sectionTitle}>Whose data?</Text>
        {!subjects ? (
          <StateView kind="loading" compact message="Loading…" />
        ) : (
          <View style={styles.chipRow}>
            {subjects.map((s) => {
              const active = subjectId === s.id;
              return (
                <Pressable
                  key={s.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setSubjectId(s.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Grantee */}
        <Text style={styles.sectionTitle}>Share with</Text>
        {eligible.length === 0 ? (
          <StateView kind="empty" compact icon="UserCheck" title="No providers" message="No verified providers available." />
        ) : (
          <View style={styles.list}>
            {eligible.map((p) => {
              const vMeta = VERTICAL_META[p.vertical];
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[vMeta.icon] ?? Icons.Activity;
              const active = granteeId === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.provider, active && styles.providerActive]}
                  onPress={() => setGranteeId(p.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.provIcon, { backgroundColor: vMeta.iconBg }]}>
                    <Icon size={18} color={vMeta.color} strokeWidth={2} />
                  </View>
                  <View style={styles.provBody}>
                    <Text style={styles.provName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={styles.provSub} numberOfLines={1}>
                      {vMeta.label} · {p.location}
                    </Text>
                  </View>
                  {active ? <Check size={18} color={Colors.secondary} strokeWidth={2.6} /> : null}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Scopes */}
        <Text style={styles.sectionTitle}>What can they see?</Text>
        <View style={styles.chipRow}>
          {CONSENT_SCOPE_OPTIONS.map((opt) => {
            const active = scopes.includes(opt.value);
            return (
              <Pressable
                key={opt.value}
                style={[styles.scopeChip, active && styles.scopeChipActive]}
                onPress={() => toggleScope(opt.value)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
              >
                {active ? <Check size={13} color={Colors.secondary} strokeWidth={2.6} /> : null}
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.ndpa}>
          <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.ndpaText}>{NDPA_CONSENT_COPY}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Grant access" onPress={onGrant} loading={grant.isPending} disabled={!canSubmit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface, marginTop: Spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  chipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  scopeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  scopeChipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.secondary },
  list: { gap: Spacing.sm },
  provider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  providerActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLow },
  provIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  provBody: { flex: 1 },
  provName: { ...Typography.labelLg, color: Colors.onSurface },
  provSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  ndpa: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  ndpaText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1, lineHeight: 16 },
  footer: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
});
