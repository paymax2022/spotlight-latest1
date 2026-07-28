import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import type { OrderStatus, DispatchStatus } from '../types';
import { normalizeStatus } from '../utils';

/**
 * Vertical status timeline for the customer tracking screen. Renders the full
 * journey including the auto-dispatch phase:
 *   Paid → Confirmed → Preparing → Ready → Finding a rider → Rider assigned →
 *   Picked up → On the way → Delivered.
 *
 * Progress is derived from the order status plus the server-side dispatch_status
 * so "Finding a rider" lights up while dispatch is searching.
 */

type StepKey =
  | 'paid'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'searching'
  | 'assigned'
  | 'picked_up'
  | 'on_the_way'
  | 'delivered';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'paid', label: 'Paid' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready for pickup' },
  { key: 'searching', label: 'Finding a rider' },
  { key: 'assigned', label: 'Rider assigned' },
  { key: 'picked_up', label: 'Picked up' },
  { key: 'on_the_way', label: 'On the way' },
  { key: 'delivered', label: 'Delivered' },
];

/** Index of the currently-active step, given status + dispatch. */
function currentStep(status: OrderStatus, dispatch?: DispatchStatus): number {
  const s = normalizeStatus(status);
  switch (s) {
    case 'placed':
      return 0; // Paid
    case 'accepted':
      return 1; // Confirmed
    case 'preparing':
      return 2;
    case 'ready':
      // While ready, dispatch determines whether we're searching or assigned.
      if (dispatch === 'assigned') return 5;
      return 4; // searching (default once ready)
    case 'assigned':
      return 5; // Rider assigned
    case 'picked_up':
      return 6; // Picked up → (on the way once moving)
    case 'delivered':
      return 8;
    default:
      return 0;
  }
}

export default function OrderTimeline({
  status,
  dispatchStatus,
}: {
  status: OrderStatus;
  dispatchStatus?: DispatchStatus;
}) {
  const current = currentStep(status, dispatchStatus);
  // "On the way" is the live leg of picked_up — treat it as reached when moving.
  const onTheWay = normalizeStatus(status) === 'picked_up' || normalizeStatus(status) === 'delivered';

  return (
    <View style={styles.wrap}>
      {STEPS.map((step, idx) => {
        const isLast = idx === STEPS.length - 1;
        let reached = idx <= current;
        if (step.key === 'on_the_way') reached = onTheWay;
        const done = idx < current || (status === 'delivered' && reached);
        const active = idx === current && !(status === 'delivered');
        return (
          <View key={step.key} style={styles.row}>
            <View style={styles.railCol}>
              <View style={[styles.dot, reached && styles.dotActive, done && styles.dotDone]}>
                {done && <Check size={12} color={Colors.white} strokeWidth={3} />}
              </View>
              {!isLast && <View style={[styles.line, reached && styles.lineActive]} />}
            </View>
            <View style={styles.labelCol}>
              <Text style={[styles.label, reached && styles.labelActive]}>{step.label}</Text>
              {active && (
                <Text style={styles.activeHint}>
                  {step.key === 'searching' ? 'Searching nearby riders…' : 'In progress'}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.md },
  railCol: { alignItems: 'center', width: 24 },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: { borderColor: Colors.secondary },
  dotDone: { backgroundColor: Colors.tertiaryContainer, borderColor: Colors.tertiaryContainer },
  line: { width: 2, flex: 1, minHeight: 22, backgroundColor: Colors.outlineVariant, marginVertical: 2 },
  lineActive: { backgroundColor: Colors.tertiaryContainer },
  labelCol: { flex: 1, paddingBottom: Spacing.md },
  label: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  labelActive: { color: Colors.onSurface, fontWeight: '600' },
  activeHint: { ...Typography.labelSm, color: Colors.secondary, marginTop: 2 },
});
