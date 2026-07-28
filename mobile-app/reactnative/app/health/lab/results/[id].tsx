import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Lock, ShieldCheck } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { formatDate } from '@/features/health/constants/health.constants';

import { useResult, useAcknowledgeResultConsent } from '@/features/health/lab/hooks';
import { RESULT_STATUS_META, RESULT_CONSENT_COPY } from '@/features/health/lab/constants';
import ResultAnalyteRow from '@/features/health/lab/components/ResultAnalyteRow';
import CriticalEscalationCard from '@/features/health/lab/components/CriticalEscalationCard';
import type { LabResult } from '@/features/health/lab/types';

export default function LabResultViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [unlocked, setUnlocked] = useState(false);

  const ack = useAcknowledgeResultConsent();
  const { data: result, isLoading, isError, refetch } = useResult(id, { enabled: unlocked });

  const onUnlock = async () => {
    try {
      await ack.mutateAsync(id);
      setUnlocked(true);
    } catch {
      // surfaced via button state; user can retry
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Lab results" subtitle="Secure, consent-protected" />

      {!unlocked ? (
        <ConsentGate loading={ack.isPending} onUnlock={onUnlock} />
      ) : isLoading ? (
        <StateView kind="loading" title="Decrypting your results" />
      ) : isError || !result ? (
        <StateView
          kind="error"
          title="Couldn't load results"
          message="Something went wrong fetching your results. Please try again."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : (
        <ResultBody result={result} />
      )}
    </SafeAreaView>
  );
}

function ConsentGate({ loading, onUnlock }: { loading: boolean; onUnlock: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.gateScroll}>
      <View style={styles.gateCard}>
        <View style={styles.gateIconWrap}>
          <Lock size={28} color={Colors.primary} />
        </View>
        <Text style={styles.gateTitle}>View your results securely</Text>
        <Text style={styles.gateBody}>{RESULT_CONSENT_COPY}</Text>

        <View style={styles.gateNote}>
          <ShieldCheck size={16} color={Colors.teal} />
          <Text style={styles.gateNoteText}>
            Your consent is logged and you can revoke shared access at any time.
          </Text>
        </View>

        <PrimaryButton label="Unlock & view" onPress={onUnlock} loading={loading} />
      </View>
    </ScrollView>
  );
}

function ResultBody({ result }: { result: LabResult }) {
  const statusMeta = RESULT_STATUS_META[result.status];

  return (
    <ScrollView contentContainerStyle={styles.bodyScroll} showsVerticalScrollIndicator={false}>
      {result.hasCritical && result.escalation ? (
        <CriticalEscalationCard escalation={result.escalation} />
      ) : null}

      <View style={styles.card}>
        <Text style={styles.testName}>{result.testName}</Text>
        <Text style={styles.labName}>{result.labName}</Text>
        {statusMeta ? (
          <View style={[styles.pill, { backgroundColor: statusMeta.bg }]}>
            <Text style={[styles.pillText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Results</Text>
        {result.analytes.map((a, i) => (
          <View key={a.id}>
            {i > 0 ? <View style={styles.divider} /> : null}
            <ResultAnalyteRow analyte={a} />
          </View>
        ))}
        <Text style={styles.caption}>Reference ranges shown per analyte</Text>
      </View>

      {result.interpretation ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Interpretation</Text>
          <Text style={styles.interpretation}>{result.interpretation}</Text>
        </View>
      ) : null}

      {result.releasedBy && result.releasedAt ? (
        <Text style={styles.released}>
          Validated & released by {result.releasedBy} · {formatDate(result.releasedAt)}
        </Text>
      ) : null}

      <View style={styles.footer}>
        <PrimaryButton
          label="Share results"
          onPress={() =>
            router.push({ pathname: '/health/lab/share-results', params: { id: result.id } })
          }
        />
        <PrimaryButton
          label="Talk to a doctor about this"
          variant="ghost"
          onPress={() =>
            router.push({
              pathname: '/health/lab/results-interpretation',
              params: { id: result.id },
            })
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  gateScroll: {
    padding: Spacing.containerMargin,
    flexGrow: 1,
    justifyContent: 'center',
  },
  gateCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    ...shadow1,
  },
  gateIconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  gateTitle: {
    ...Typography.titleLg,
    color: Colors.onSurface,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  gateBody: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  gateNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  gateNoteText: {
    ...Typography.bodySm,
    color: Colors.onSurfaceVariant,
    flex: 1,
  },

  bodyScroll: {
    padding: Spacing.containerMargin,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...shadow1,
  },
  testName: { ...Typography.titleLg, color: Colors.onSurface },
  labName: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
    marginTop: Spacing.xs,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    marginTop: Spacing.md,
  },
  pillText: { ...Typography.labelMd },
  sectionTitle: {
    ...Typography.titleMd,
    color: Colors.onSurface,
    marginBottom: Spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.outlineVariant,
    marginVertical: Spacing.xs,
  },
  caption: {
    ...Typography.caption,
    color: Colors.onSurfaceVariant,
    marginTop: Spacing.md,
  },
  interpretation: { ...Typography.bodyMd, color: Colors.onSurface },
  released: {
    ...Typography.bodySm,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  footer: { gap: Spacing.sm, marginTop: Spacing.sm },
});
