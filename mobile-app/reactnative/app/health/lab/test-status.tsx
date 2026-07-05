import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleCheck, Circle, TriangleAlert, Lock, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import ChainOfCustodyTimeline from '@/features/health/lab/components/ChainOfCustodyTimeline';
import { ORDER_TIMELINE, timelineIndex, PAYMENT_HELD_COPY } from '@/features/health/lab/constants';
import { useOrder, useOrders } from '@/features/health/lab/hooks';
import type { LabOrder } from '@/features/health/lab/types';

const ACTIVE = ['CREATED', 'SCHEDULED', 'SAMPLE_COLLECTED', 'IN_TRANSIT', 'ACCESSIONED', 'RESULT_READY', 'ESCALATED'];

export default function TestStatusScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const oneQ = useOrder(id);
  const listQ = useOrders();
  const usingOne = Boolean(id);

  const query = usingOne ? oneQ : listQ;
  const order: LabOrder | undefined = usingOne
    ? oneQ.data
    : (listQ.data ?? []).find((o) => ACTIVE.includes(o.status)) ?? (listQ.data ?? [])[0];

  const showResults =
    !!order?.resultId &&
    (order.status === 'RESULT_READY' || order.status === 'ESCALATED' || order.status === 'RELEASED');
  const critical = order?.status === 'ESCALATED' || order?.hasCritical;
  const currentIdx = order ? timelineIndex(order.status) : -1;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Test status" subtitle={order ? order.labName : undefined} />
      {query.isLoading ? (
        <StateView kind="loading" title="Loading status…" />
      ) : query.isError ? (
        <StateView
          kind="error"
          title="Couldn't load status"
          message="We couldn't fetch your test status. Please try again."
          actionLabel="Retry"
          onAction={() => query.refetch()}
        />
      ) : !order ? (
        <StateView
          kind="empty"
          icon="FlaskConical"
          title="No active orders"
          message="When you book a lab test it will appear here so you can track every step."
          actionLabel="Browse tests"
          onAction={() => router.push('/health/lab/catalog')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {critical ? (
            <Pressable
              style={styles.criticalBanner}
              accessibilityRole="button"
              onPress={() =>
                order.resultId &&
                router.push({ pathname: '/health/lab/results/[id]', params: { id: order.resultId } })
              }
            >
              <TriangleAlert size={20} color={Colors.error} strokeWidth={2.2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.criticalTitle}>Critical value found — escalation active</Text>
                <Text style={styles.criticalText}>
                  A critical result was detected. Per HL-7 this is never silent: a clinician has been
                  notified and is reviewing. Tap to view the result.
                </Text>
              </View>
              <ChevronRight size={18} color={Colors.error} />
            </Pressable>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Progress</Text>
            <View style={{ marginTop: Spacing.sm }}>
              {ORDER_TIMELINE.map((step, i) => {
                const done = currentIdx >= 0 && i < currentIdx;
                const isCurrent = i === currentIdx;
                const last = i === ORDER_TIMELINE.length - 1;
                return (
                  <View key={step.status} style={styles.tlRow}>
                    <View style={styles.tlRail}>
                      {done || isCurrent ? (
                        <CircleCheck
                          size={20}
                          color={isCurrent ? Colors.primary : Colors.teal}
                          strokeWidth={2.2}
                          fill={isCurrent ? undefined : 'transparent'}
                        />
                      ) : (
                        <Circle size={20} color={Colors.outline} strokeWidth={2} />
                      )}
                      {!last ? (
                        <View
                          style={[styles.tlLine, { backgroundColor: done ? Colors.teal : Colors.outlineVariant }]}
                        />
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.tlLabel,
                        isCurrent && { color: Colors.onSurface, ...Typography.labelLg },
                        !done && !isCurrent && { color: Colors.onSurfaceVariant },
                      ]}
                    >
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {order.custody && order.custody.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Chain of custody</Text>
              <Text style={styles.cardSub}>Every hand-off of your sample is tracked (HL-6).</Text>
              <View style={{ marginTop: Spacing.md }}>
                <ChainOfCustodyTimeline events={order.custody} />
              </View>
            </View>
          ) : null}

          {order.paymentHeld ? (
            <View style={styles.heldRow}>
              <Lock size={16} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
              <Text style={styles.heldText}>{PAYMENT_HELD_COPY}</Text>
            </View>
          ) : null}

          {showResults ? (
            <PrimaryButton
              label="View results"
              onPress={() =>
                router.push({ pathname: '/health/lab/results/[id]', params: { id: order.resultId! } })
              }
            />
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xl },
  criticalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  criticalTitle: { ...Typography.labelLg, color: Colors.error },
  criticalText: { ...Typography.bodySm, color: Colors.error, marginTop: 2 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    ...shadow1,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  tlRow: { flexDirection: 'row', gap: Spacing.md },
  tlRail: { alignItems: 'center', width: 20 },
  tlLine: { width: 2, flex: 1, minHeight: 24, marginVertical: 2 },
  tlLabel: { ...Typography.bodyMd, color: Colors.onSurface, paddingBottom: Spacing.md, paddingTop: 1 },
  heldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  heldText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
});
