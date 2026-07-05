import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { FileText, Eye, Share, Lock, TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useRecord, useDocSignedUrl } from '@/features/health/hooks';
import { RECORD_KIND_META, HealthColors, formatDate } from '@/features/health/constants/health.constants';

export default function RecordDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: record, isLoading, isError, refetch } = useRecord(id);
  const signedUrl = useDocSignedUrl();

  const openDoc = (docId: string) => {
    if (!record) return;
    signedUrl.mutate(
      { recordId: record.id, docId },
      {
        onSuccess: (res) => {
          // Placeholder: a production build opens an in-app signed-URL document
          // viewer (HL-8). The signed URL is short-lived and access-logged.
          Alert.alert(
            'Secure document',
            `A signed, time-limited link was issued (expires ${formatDate(res.expiresAt)}).\n\nThe document viewer opens here in the full build.`,
          );
        },
        onError: () => Alert.alert('Unable to open', 'Could not issue a secure link. Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Record"
        rightSlot={
          record ? (
            <Pressable
              onPress={() => router.push({ pathname: '/health/records/share', params: { recordId: record.id } })}
              hitSlop={8}
              accessibilityLabel="Share with consent"
            >
              <Share size={20} color={Colors.primary} strokeWidth={2} />
            </Pressable>
          ) : undefined
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading record…" />
      ) : isError || !record ? (
        <StateView kind="error" title="Record not found" message="This record may have been removed." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {(() => {
            const meta = RECORD_KIND_META[record.kind];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.FileText;
            return (
              <View style={[styles.header, shadow1]}>
                <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
                  <Icon size={24} color={meta.color} strokeWidth={2} />
                </View>
                <Text style={styles.kind}>{meta.label}</Text>
                <Text style={styles.title}>{record.title}</Text>
                <Text style={styles.meta}>
                  {record.subjectName} · {record.providerName ?? 'Self-added'} · {formatDate(record.issuedAt)}
                </Text>
                {record.flagged ? (
                  <View style={styles.flag}>
                    <TriangleAlert size={14} color={HealthColors.danger} strokeWidth={2.2} />
                    <Text style={styles.flagText}>
                      Abnormal result — your clinician has been notified for follow-up.
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })()}

          {/* Summary */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Summary</Text>
            <Text style={styles.body}>{record.summary}</Text>
          </View>

          {/* Clinical fields */}
          {record.fields && record.fields.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Details</Text>
              {record.fields.map((f, i) => (
                <View key={f.label} style={[styles.fieldRow, i > 0 && styles.fieldDivider]}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  <Text style={styles.fieldValue}>{f.value}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Documents (signed-URL viewer placeholder) */}
          <View style={styles.card}>
            <View style={styles.docHead}>
              <Text style={styles.cardTitle}>Documents</Text>
              <View style={styles.secure}>
                <Lock size={11} color={Colors.teal} strokeWidth={2} />
                <Text style={styles.secureText}>Signed-URL</Text>
              </View>
            </View>
            {record.docs.length === 0 ? (
              <Text style={styles.body}>No attached documents.</Text>
            ) : (
              record.docs.map((doc) => (
                <Pressable key={doc.id} style={styles.docRow} onPress={() => openDoc(doc.id)}>
                  <View style={styles.docIcon}>
                    <FileText size={18} color={Colors.secondary} strokeWidth={2} />
                  </View>
                  <Text style={styles.docLabel} numberOfLines={1}>
                    {doc.label}
                  </Text>
                  {signedUrl.isPending && signedUrl.variables?.docId === doc.id ? (
                    <ActivityIndicator size="small" color={Colors.secondary} />
                  ) : (
                    <Eye size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  )}
                </Pressable>
              ))
            )}
          </View>

          <PrimaryButton
            label="Share with consent"
            variant="secondary"
            onPress={() => router.push({ pathname: '/health/records/share', params: { recordId: record.id } })}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, paddingBottom: 100, gap: Spacing.md },
  header: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  iconBox: { width: 56, height: 56, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  kind: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { ...Typography.headlineMd, fontSize: 22, color: Colors.onSurface, textAlign: 'center' },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.sm,
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 8,
  },
  flagText: { ...Typography.caption, color: Colors.error, flex: 1 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardTitle: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm },
  fieldDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, flex: 1 },
  fieldValue: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  docHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  secure: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  secureText: { ...Typography.caption, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.sm + 2,
  },
  docIcon: { width: 36, height: 36, borderRadius: Radius.sm, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  docLabel: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
});
