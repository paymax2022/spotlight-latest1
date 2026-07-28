import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Stethoscope, ClipboardList, ArrowRight } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getVisitSummary, getPrescription } from '@/api/telemedicine.api';
import { TeleHeader, PrescriptionCard } from '@/features/telemedicine/components';
import PrimaryButton from '@/components/PrimaryButton';

export default function VisitSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['tele-summary', id],
    queryFn:  () => getVisitSummary(String(id)),
  });

  const { data: prescription } = useQuery({
    queryKey: ['tele-prescription', id],
    queryFn:  () => getPrescription(String(id)),
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Visit Summary" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {loadingSummary && !summary ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : (
          <>
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

            <View style={styles.orderCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderTitle}>Order your medication</Text>
                <Text style={styles.orderSub}>Get this prescription delivered from a partner pharmacy.</Text>
              </View>
              <ArrowRight size={20} color={Colors.secondary} strokeWidth={2} />
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <PrimaryButton
            label="Download"
            variant="secondary"
            fullWidth={false}
            style={{ flex: 1 }}
            onPress={() => { /* TODO(Phase C): export PDF visit summary */ }}
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
