import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Inbox, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, ResultInboxRow } from '@/features/doctor/components';
import { useResultInbox } from '@/features/doctor/hooks';

// ── Section N — Lab results inbox (N1–N4) ─────────────────────────────────────
// NEW screen: results inbox with new/critical flags and pending/ready/delayed
// states (ResultInboxRow). Reachable from the records hub and lab detail.

export default function LabResultInboxScreen() {
  const { data: inbox = [], isLoading, isError, refetch } = useResultInbox();
  const criticalCount = inbox.filter((i) => i.hasCritical).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Lab Results" />

      {isLoading && inbox.length === 0 ? (
        <StateView variant="loading" label="Loading results" />
      ) : isError ? (
        <StateView variant="error" message="We could not load lab results." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* N4 — critical-result alert banner */}
          {criticalCount > 0 && (
            <View style={styles.alert}>
              <AlertTriangle size={16} color={Colors.error} strokeWidth={2.2} />
              <Text style={styles.alertText}>{criticalCount} result{criticalCount > 1 ? 's have' : ' has'} a critical value needing review.</Text>
            </View>
          )}

          {inbox.length === 0 ? (
            <StateView variant="empty" icon={Inbox} title="No results yet" message="Lab results awaiting review will appear here." />
          ) : (
            <View style={styles.list}>
              {inbox.map((item) => (
                <ResultInboxRow key={item.resultId} item={item} onPress={(it) => router.push(`/(doctor)/lab/${it.orderId}`)} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.sm, flexGrow: 1 },
  alert:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.errorContainer, marginBottom: Spacing.xs },
  alertText: { flex: 1, ...Typography.labelSm, color: Colors.error },
  list:      { gap: Spacing.sm },
});
