// The one place either side extends a consult. Every control here is advisory:
// the engine re-checks state, approval and the payment window, so a stale tap
// returns a 409 instead of granting unpaid time.

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, Clock, X } from 'lucide-react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { formatNaira } from '@/utils/money';
import { formatConsultClock } from './sessionTimer';
import {
  extensionAction,
  maxExtensionMinutes,
  openExtension,
  type ConsultViewer,
} from './roomView';
import type { ConsultExtension, ConsultSession } from './types';

const PRESETS = [10, 15, 30, 60];

export interface ExtensionSheetProps {
  visible: boolean;
  session: ConsultSession;
  extensions: ConsultExtension[];
  viewer: ConsultViewer;
  /** Server-projected "now" (client clock + serverOffsetMs). */
  nowMs: number;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onRequest: (minutes: number) => void;
  onDecide: (extensionId: string, approve: boolean) => void;
  onPay: (ext: ConsultExtension) => void;
}

export default function ExtensionSheet({
  visible,
  session,
  extensions,
  viewer,
  nowMs,
  busy = false,
  error,
  onClose,
  onRequest,
  onDecide,
  onPay,
}: ExtensionSheetProps) {
  const cap = maxExtensionMinutes(session);
  const options = useMemo(() => PRESETS.filter((m) => m <= cap), [cap]);
  const [minutes, setMinutes] = useState(options[0] ?? 10);
  const open = openExtension(extensions);
  const action = extensionAction(open, viewer, nowMs);
  const paid = extensions.filter((ext) => ext.status === 'paid' && ext.price_kobo > 0).slice(-2);

  useEffect(() => {
    if (!options.includes(minutes)) setMinutes(options[0] ?? 10);
  }, [minutes, options]);

  const payWindow =
    open?.payment_expires_at && action.kind === 'pay'
      ? Math.max(0, Math.ceil((Date.parse(open.payment_expires_at) - nowMs) / 1000))
      : null;

  const askLabel = viewer === 'provider' ? `Add ${minutes} min` : `Request ${minutes} min`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Session time</Text>
            {!busy && (
              <Pressable onPress={onClose} hitSlop={10}>
                <X size={22} color={Colors.onSurfaceVariant} />
              </Pressable>
            )}
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.clockRow}>
              <Clock size={18} color={Colors.secondary} />
              <Text style={styles.clockText}>
                Booked for {session.duration_minutes} minutes · ends{' '}
                {new Date(session.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>

            {open?.status === 'pending_approval' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {open.added_minutes} more minutes requested
                </Text>
                <Text style={styles.cardBody}>
                  {viewer === 'provider'
                    ? `The patient will pay ${formatNaira(open.price_kobo, { decimals: false })} after you approve.`
                    : 'Waiting for the provider to approve. You pay only after approval.'}
                </Text>
                {viewer === 'provider' ? (
                  <View style={styles.row}>
                    <Pressable
                      style={[styles.secondaryButton, busy && styles.disabled]}
                      disabled={busy}
                      onPress={() => onDecide(open.id, false)}
                    >
                      <Text style={styles.secondaryLabel}>Decline</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.primaryButton, styles.grow, busy && styles.disabled]}
                      disabled={busy}
                      onPress={() => onDecide(open.id, true)}
                    >
                      <Check size={16} color={Colors.onPrimary} />
                      <Text style={styles.primaryLabel}>Approve</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.waitRow}>
                    <ActivityIndicator size="small" color={Colors.secondary} />
                    <Text style={styles.waitText}>Awaiting approval…</Text>
                  </View>
                )}
              </View>
            )}

            {open?.status === 'approved_awaiting_payment' && action.kind !== 'closed' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Approved — {open.added_minutes} more minutes</Text>
                <Text style={styles.cardBody}>
                  {viewer === 'patient'
                    ? `Pay ${formatNaira(open.price_kobo, { decimals: false })} to add the time.`
                    : 'Approved. Waiting for the patient to pay.'}
                </Text>
                {viewer === 'patient' ? (
                  <>
                    {payWindow !== null && (
                      <Text style={styles.windowText}>
                        Offer expires in {formatConsultClock(payWindow)}
                      </Text>
                    )}
                    <Pressable
                      style={[styles.primaryButton, busy && styles.disabled]}
                      disabled={busy}
                      onPress={() => onPay(open)}
                    >
                      <Text style={styles.primaryLabel}>
                        Pay {formatNaira(open.price_kobo, { decimals: false })}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.waitRow}>
                    <ActivityIndicator size="small" color={Colors.secondary} />
                    <Text style={styles.waitText}>Awaiting payment…</Text>
                  </View>
                )}
              </View>
            )}

            {action.kind === 'closed' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>The payment window closed</Text>
                <Text style={styles.cardBody}>Ask to extend again if the session is still running.</Text>
              </View>
            )}

            {(action.kind === 'request' || action.kind === 'closed') && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>How much longer?</Text>
                {options.length === 0 ? (
                  <Text style={styles.cardBody}>
                    This session cannot be extended any further — it has reached its four-hour limit.
                  </Text>
                ) : (
                  <>
                    <View style={styles.chips}>
                      {options.map((m) => {
                        const selected = m === minutes;
                        return (
                          <Pressable
                            key={m}
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => setMinutes(m)}
                            disabled={busy}
                          >
                            <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                              {m} min
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.helper}>
                      {viewer === 'provider'
                        ? 'Extensions you add are free and apply immediately.'
                        : 'Your provider must approve before you pay. The price is shown after approval.'}
                    </Text>
                    <Pressable
                      style={[styles.primaryButton, busy && styles.disabled]}
                      disabled={busy || options.length === 0}
                      onPress={() => onRequest(minutes)}
                    >
                      <Text style={styles.primaryLabel}>{askLabel}</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}

            {paid.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Already added</Text>
                {paid.map((ext) => (
                  <Text key={ext.id} style={styles.cardBody}>
                    +{ext.added_minutes} min · {formatNaira(ext.price_kobo, { decimals: false })}
                  </Text>
                ))}
              </View>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '86%',
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerMargin,
    paddingBottom: Spacing.sm,
  },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  body: { padding: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.md },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  clockText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  card: {
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  grow: { flex: 1 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
  },
  primaryLabel: { ...Typography.labelLg, color: Colors.onPrimary },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.outline,
    borderRadius: Radius.full,
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
  },
  secondaryLabel: { ...Typography.labelLg, color: Colors.onSurface },
  disabled: { opacity: 0.5 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  waitText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  windowText: { ...Typography.labelMd, color: Colors.onWarning },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipLabel: { ...Typography.labelMd, color: Colors.onSurface },
  chipLabelSelected: { color: Colors.onPrimary },
  helper: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodySm, color: Colors.error },
});
