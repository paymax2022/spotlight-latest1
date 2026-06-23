import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { FileText, Sparkles, History, CheckCheck, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useDocument, useAcknowledgeDocument } from '@/features/association/hooks/useEngagement';
import { formatDate } from '@/features/association/utils/associationFormatters';
import { DOC_CATEGORY_LABEL } from '@/features/association/constants/engagement.constants';

export default function DocumentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useDocument(id);
  const ack = useAcknowledgeDocument();

  if (doc.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Document" />
        <StateView kind="loading" message="Loading document…" />
      </SafeAreaView>
    );
  }
  if (doc.isError || !doc.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Document" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => doc.refetch()} />
      </SafeAreaView>
    );
  }

  const d = doc.data;

  // Access-gated state.
  if (d.restricted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Document" />
        <StateView
          kind="empty"
          icon="Lock"
          title="Restricted document"
          message="This document is limited to authorised roles (e.g. Executive Council). Contact your admin if you need access."
        />
      </SafeAreaView>
    );
  }

  const acknowledged = d.acknowledged || ack.isSuccess;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Document" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Preview placeholder */}
        <View style={styles.preview}>
          <FileText size={40} color={Colors.secondary} strokeWidth={1.6} />
          <Text style={styles.previewText}>{d.kind.toUpperCase()} · {d.sizeLabel}</Text>
        </View>

        <Text style={styles.title}>{d.title}</Text>
        <Text style={styles.meta}>
          {DOC_CATEGORY_LABEL[d.category]} · {d.version} · Updated {formatDate(d.updatedAt)}
        </Text>
        {d.description ? <Text style={styles.body}>{d.description}</Text> : null}

        {/* Actions */}
        <View style={styles.actions}>
          <PrimaryButton label="Download" variant="secondary" fullWidth={false} style={styles.actionBtn}
            onPress={() => Alert.alert('Download', 'Download is not available in this preview build.')} />
          <PrimaryButton label="Share" variant="secondary" fullWidth={false} style={styles.actionBtn}
            onPress={() => Alert.alert('Share', 'Sharing is not available in this preview build.')} />
        </View>

        {/* AI summary */}
        {d.aiSummary ? (
          <View style={styles.aiCard}>
            <View style={styles.aiHead}>
              <Sparkles size={15} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.aiTitle}>AI summary</Text>
            </View>
            <Text style={styles.aiBody}>{d.aiSummary}</Text>
          </View>
        ) : null}

        {/* Version history */}
        <Text style={styles.sectionTitle}>Version history</Text>
        <View style={[styles.card, shadow1]}>
          {d.versionHistory.map((v, i) => (
            <View key={v.version} style={[styles.versionRow, i > 0 && styles.versionDivider]}>
              <History size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.versionLabel}>{v.version} · {formatDate(v.date)}</Text>
                <Text style={styles.versionNote}>{v.note}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.uploadedRow}>
          <Lock size={13} color={Colors.outline} strokeWidth={2} />
          <Text style={styles.uploadedText}>Uploaded by {d.uploadedBy}</Text>
        </View>
      </ScrollView>

      {d.requiresAck ? (
        <View style={styles.footer}>
          {acknowledged ? (
            <View style={styles.ackDone}>
              <CheckCheck size={18} color={Colors.teal} strokeWidth={2.4} />
              <Text style={styles.ackDoneText}>Acknowledged</Text>
            </View>
          ) : (
            <PrimaryButton label="I acknowledge this document" onPress={() => ack.mutate(d.id)} loading={ack.isPending} />
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  preview: { height: 140, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: Colors.outlineVariant },
  previewText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { flex: 1 },
  aiCard: { backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md, gap: 6 },
  aiHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aiTitle: { ...Typography.labelLg, color: Colors.primary },
  aiBody: { ...Typography.bodyMd, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  versionDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  versionLabel: { ...Typography.labelMd, color: Colors.onSurface },
  versionNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  uploadedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  uploadedText: { ...Typography.caption, color: Colors.outline },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  ackDone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  ackDoneText: { ...Typography.labelMd, color: Colors.teal },
});
