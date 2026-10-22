import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Stethoscope, ClipboardList, ArrowRight } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { getVisitSummary, getPrescription } from '@/api/telemedicine.api';
import { TeleHeader, PrescriptionCard } from '@/features/telemedicine/components';
import { exportVisitSummary, summaryFileName } from '@/features/telemedicine/exportSummary';
import PrimaryButton from '@/components/PrimaryButton';

export default function VisitSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const recordRef = useRef<View>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const { data: summary, isLoading: loadingSummary, isError: summaryMissing } = useQuery({
    queryKey: ['tele-summary', id],
    queryFn:  () => getVisitSummary(String(id)),
  });

  const { data: prescription } = useQuery({
    queryKey: ['tele-prescription', id],
    queryFn:  () => getPrescription(String(id)),
  });

  const onDownload = async () => {
    if (exporting) return;
    setExporting(true);
    setExportNote(null);
    const outcome = await exportVisitSummary(recordRef.current, summaryFileName(String(id)));
    setExporting(false);
    if (outcome === 'failed') setExportNote('Could not save the summary. Please try again.');
    else if (outcome === 'unsupported') setExportNote('Saving is not available on this device.');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Visit Summary" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {loadingSummary && !summary ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : summaryMissing ? (
          <View style={[styles.card, shadow1]}>
            <Text style={styles.cardTitle}>Summary not filed yet</Text>
            <Text style={styles.notes}>
              Your doctor hasn’t written up this visit. It shows up here as soon as they close the
              consult — you can still rate the visit below.
            </Text>
          </View>
        ) : (
          <>
            <View ref={recordRef} collapsable={false} style={styles.record}>
              <View style={[styles.card, shadow1]}>
                <View style={styles.head}>
                  <View style={styles.iconBox}><Stethoscope size={18} color={Colors.primary} strokeWidth={2} /></View>
                  <Text style={styles.cardTitle}>Diagnosis</Text>
                </View>
                <Text style={styles.diagnosis}>{summary?.diagnosis}</Text>
              </View>

              <View style={[styles.card, shadow1]}>
                <View style={styles.head}>
                  <View style={[styles.iconBox, { backgroundColor: Colors.iconBgBlue }]}><ClipboardList size={18} color={Colors.secondary} strokeWidth={2} /></View>
                  <Text style={styles.cardTitle}>Clinical notes</Text>
                </View>
                <Text style={styles.notes}>{summary?.notes}</Text>
                {summary?.followUp ? (
                  <View style={styles.followUp}>
                    <Text style={styles.followLabel}>Follow-up</Text>
                    <Text style={styles.followText}>{summary.followUp}</Text>
                  </View>
                ) : null}
              </View>

              {prescription ? <PrescriptionCard prescription={prescription} /> : null}
            </View>

            <Pressable
              style={styles.orderCard}
              onPress={() => router.push('/health/pharmacy/send-rx')}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.orderTitle}>Order your medication</Text>
                <Text style={styles.orderSub}>Get this prescription delivered from a partner pharmacy.</Text>
              </View>
              <ArrowRight size={20} color={Colors.secondary} strokeWidth={2} />
            </Pressable>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {exportNote ? <Text style={styles.exportNote}>{exportNote}</Text> : null}
        <View style={styles.footerRow}>
          <PrimaryButton
            label={exporting ? 'Saving…' : 'Download'}
            variant="secondary"
            fullWidth={false}
            style={{ flex: 1 }}
            disabled={exporting || (!!summaryMissing)}
            onPress={onDownload}
          />
          <PrimaryButton
            label="Rate visit"
            fullWidth={false}
            style={{ flex: 1 }}
            onPress={() => router.push(`/services/telemedicine/appointment/${id}/review`)}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: 120, gap: Spacing.md },
  // Everything the patient saves as their record; the action cards stay out of it.
  record:      { gap: Spacing.md },
  exportNote:  { ...Typography.labelSm, color: Colors.error, marginBottom: Spacing.sm },
  card:        { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  head:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  iconBox:     { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  diagnosis:   { ...Typography.titleMd, color: Colors.primary, fontWeight: '700' },
  notes:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  followUp:    { marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderLeftWidth: 3, borderLeftColor: Colors.teal },
  followLabel: { ...Typography.labelSm, color: Colors.teal, marginBottom: 2 },
  followText:  { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 20 },
  orderCard:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.iconBgBlue, borderWidth: 1, borderColor: Colors.secondaryFixed },
  orderTitle:  { ...Typography.labelLg, color: Colors.onSurface },
  orderSub:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  footer:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 32 : Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  footerRow:   { flexDirection: 'row', gap: Spacing.sm },
});
