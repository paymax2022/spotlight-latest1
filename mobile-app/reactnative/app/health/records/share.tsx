import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Check, ShieldCheck, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useRecord, useProviders, useGrantConsent } from '@/features/health/hooks';
import {
  VERTICAL_META,
  RECORD_KIND_META,
  NDPA_CONSENT_COPY,
  scopeLabel,
} from '@/features/health/constants/health.constants';

/**
 * Share a specific record with a provider — creates a scoped, revocable consent
 * grant (HL-8). Consent is surfaced explicitly before sharing.
 */
export default function ShareRecordScreen() {
  const { recordId } = useLocalSearchParams<{ recordId: string }>();
  const { data: record, isLoading } = useRecord(recordId);
  const { data: providers } = useProviders();
  const grant = useGrantConsent();
  const [granteeId, setGranteeId] = useState<string>('');

  const eligible = useMemo(() => providers ?? [], [providers]);

  const onShare = () => {
    if (!record || !granteeId) return;
    grant.mutate(
      {
        subjectId: record.subjectId,
        granteeId,
        granteeVertical: eligible.find((p) => p.id === granteeId)!.vertical,
        scopes: [record.kind],
      },
      {
        onSuccess: () => {
          Alert.alert('Shared', 'A revocable consent grant was created. Manage it anytime in Consent.', [
            { text: 'Done', onPress: () => router.back() },
          ]);
        },
        onError: () => Alert.alert('Could not share', 'Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Share record"
        showBack={false}
        rightSlot={
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Close">
            <X size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading || !record ? (
        <StateView kind="loading" message="Preparing share…" />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* What's being shared */}
          <View style={[styles.card, shadow1]}>
            <Text style={styles.cardLabel}>You are sharing</Text>
            <Text style={styles.recordTitle}>{record.title}</Text>
            <Text style={styles.recordSub}>
              {RECORD_KIND_META[record.kind].label} · {record.subjectName}
            </Text>
            <View style={styles.scopePill}>
              <Text style={styles.scopePillText}>Scope: {scopeLabel(record.kind)}</Text>
            </View>
          </View>

          {/* Choose a grantee */}
          <Text style={styles.sectionTitle}>Share with</Text>
          {eligible.length === 0 ? (
            <StateView kind="empty" compact icon="UserCheck" title="No providers" message="No verified providers available to share with yet." />
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

          {/* NDPA consent */}
          <View style={styles.ndpa}>
            <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.ndpaText}>{NDPA_CONSENT_COPY}</Text>
          </View>
        </ScrollView>
      )}

      {record ? (
        <View style={styles.footer}>
          <PrimaryButton
            label="Grant consent & share"
            onPress={onShare}
            loading={grant.isPending}
            disabled={!granteeId}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
  },
  cardLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4 },
  recordTitle: { ...Typography.titleLg, color: Colors.onSurface },
  recordSub: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  scopePill: { alignSelf: 'flex-start', marginTop: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.full, paddingHorizontal: Spacing.sm + 2, paddingVertical: 4 },
  scopePillText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' as const },
  sectionTitle: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface },
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
  },
  ndpaText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1, lineHeight: 16 },
  footer: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
});
