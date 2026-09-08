import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Bike, Store } from 'lucide-react-native';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { usePharmacyOrder, usePharmacyOrderAction } from '@/features/pharmacymerchant/hooks';
import { actionsFor, stateLabel } from '@/features/pharmacymerchant/actions';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

/**
 * One order, and the actions the pharmacist may take on it right now.
 *
 * The buttons come from actionsFor(state), which mirrors the server's guarded
 * transition table — so the screen never offers a move the API would reject, and
 * never hides one that would strand a paid order.
 *
 * There is deliberately no cancel: cancelling refunds the held payment and the
 * server allows it only for the patient.
 */
export default function PharmacyOrderScreen() {
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const id = typeof rawId === 'string' ? rawId : '';
  const q = usePharmacyOrder(id);
  const act = usePharmacyOrderAction(id);

  const [pickupCode, setPickupCode] = useState('');
  const [method, setMethod] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [error, setError] = useState<string | null>(null);

  const order = q.data;
  const actions = order ? actionsFor(order.state) : [];

  const run = (action: 'confirm' | 'dispense' | 'dispatch' | 'complete', requiresCode?: boolean) => {
    if (requiresCode && !pickupCode.trim()) {
      setError('Enter the code the customer is showing you.');
      return;
    }
    setError(null);
    act.mutate(
      { action, method, pickupCode: requiresCode ? pickupCode.trim() : undefined },
      {
        onSuccess: () => setPickupCode(''),
        // The server owns these rules (Rx match, pickup-code check, legal
        // transition), so surface ITS message rather than inventing one.
        onError: (e: unknown) => {
          const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setError(msg || 'That didn’t go through. Try again.');
        },
      },
    );
  };

  if (q.isLoading) {
    return <Shell><StateView kind="loading" title="Loading order" /></Shell>;
  }
  if (q.isError || !order) {
    return (
      <Shell>
        <StateView
          kind="error"
          title="Couldn’t load this order"
          message="It may belong to another pharmacy, or your connection dropped."
          actionLabel="Retry"
          onAction={() => q.refetch()}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <ScrollView contentContainerStyle={st.body}>
        <View style={[st.card, shadow1]}>
          <View style={st.rowBetween}>
            <Text style={st.orderId}>#{order.id.slice(0, 8)}</Text>
            <View style={st.pill}><Text style={st.pillText}>{stateLabel(order.state)}</Text></View>
          </View>
          <Text style={st.total}>{naira(order.total_kobo)}</Text>
          <Text style={st.muted}>
            {order.prescription_id ? 'Prescription order' : 'Over-the-counter order'}
            {order.fulfilment_method ? ` · ${order.fulfilment_method.toLowerCase()}` : ''}
          </Text>
        </View>

        {order.lines && order.lines.length > 0 ? (
          <View style={[st.card, shadow1]}>
            <Text style={st.section}>Items</Text>
            {order.lines.map((l, i) => (
              <View key={`${l.product_id ?? i}`} style={st.lineRow}>
                <Text style={st.lineName} numberOfLines={1}>{l.name ?? 'Item'}</Text>
                <Text style={st.muted}>×{l.quantity ?? 1}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {actions.length === 0 ? (
          <View style={[st.card, shadow1]}>
            <Text style={st.section}>Nothing to do</Text>
            <Text style={st.muted}>
              This order is {stateLabel(order.state).toLowerCase()}. Anything further is up to the
              customer or the delivery rider.
            </Text>
          </View>
        ) : (
          actions.map((a) => (
            <View key={a.action} style={[st.card, shadow1]}>
              <Text style={st.section}>{a.label}</Text>
              <Text style={st.muted}>{a.hint}</Text>

              {a.requiresFulfilmentChoice ? (
                <View style={st.choiceRow}>
                  {([['DELIVERY', 'Deliver', Bike], ['PICKUP', 'Collection', Store]] as const).map(
                    ([value, label, Icon]) => (
                      <Pressable
                        key={value}
                        onPress={() => setMethod(value)}
                        style={[st.choice, method === value && st.choiceActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: method === value }}
                      >
                        <Icon size={15} color={method === value ? Colors.onPrimary : Colors.onSurfaceVariant} strokeWidth={2} />
                        <Text style={[st.choiceText, method === value && st.choiceTextActive]}>{label}</Text>
                      </Pressable>
                    ),
                  )}
                </View>
              ) : null}

              {a.requiresPickupCode ? (
                <View style={{ gap: 6 }}>
                  <Text style={st.label}>Customer’s pickup code</Text>
                  <TextInput
                    value={pickupCode}
                    onChangeText={(t) => { setPickupCode(t); if (error) setError(null); }}
                    placeholder="e.g. 4821"
                    placeholderTextColor={Colors.outline}
                    autoCapitalize="characters"
                    style={st.input}
                    accessibilityLabel="Pickup code"
                  />
                </View>
              ) : null}

              {error ? <Text style={st.error}>{error}</Text> : null}

              <PrimaryButton
                label={a.label}
                onPress={() => run(a.action, a.requiresPickupCode)}
                loading={act.isPending}
                disabled={act.isPending}
              />
            </View>
          ))
        )}
      </ScrollView>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <ScreenHeader title="Order" />
      {children}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.md, gap: Spacing.sm },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderId: { ...Typography.labelLg, color: Colors.onSurface },
  total: { ...Typography.headlineMd, color: Colors.onSurface },
  section: { ...Typography.labelLg, color: Colors.onSurface },
  muted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pill: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  pillText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  lineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  lineName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  choiceRow: { flexDirection: 'row', gap: Spacing.xs },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: 9,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
  choiceActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  choiceText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  choiceTextActive: { color: Colors.onPrimary },
  input: {
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 10, color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow,
  },
  error: { ...Typography.bodySm, color: Colors.error },
});
