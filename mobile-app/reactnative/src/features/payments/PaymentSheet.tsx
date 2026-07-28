import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Wallet, CreditCard, X } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import type { PurchaseController } from './usePurchasePayment';

function naira(kobo: number): string {
  return '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Shared checkout sheet: lets the user pay a purchase from their wallet balance
// OR directly via card (Paystack). Drop it once near a module's pay button and
// drive it with usePurchasePayment().
export default function PaymentSheet({ controller }: { controller: PurchaseController<any> }) {
  const { visible, phase, error, request, walletKobo, walletLoading, pay, close, GatewaySheet } = controller;
  if (!request) return null;

  const amount = request.amountKobo;
  const walletCovers = walletKobo >= amount;
  const busy = phase === 'awaiting' || phase === 'charging';
  // When the caller preselected a method, this screen already chose how to pay —
  // don't show the in-sheet chooser; just surface progress (and retry on error).
  const preselected = !!request.method;

  const phaseLabel: Record<string, string> = {
    awaiting: 'Opening secure payment…',
    charging: 'Finalising your order…',
  };

  return (
  <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? undefined : close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handleRow}>
            <Text style={styles.title}>{request.title ?? 'Choose how to pay'}</Text>
            {!busy && (
              <Pressable onPress={close} hitSlop={10}>
                <X size={22} color={Colors.onSurfaceVariant} />
              </Pressable>
            )}
          </View>

          <Text style={styles.amount}>{naira(amount)}</Text>

          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.busyText}>{phaseLabel[phase] ?? 'Processing…'}</Text>
              {phase === 'awaiting' && (
                <Text style={styles.hint}>Return to the app after paying — we’ll confirm automatically.</Text>
              )}
            </View>
          ) : preselected ? (
            <View style={styles.busy}>
              {phase === 'error' ? (
                <>
                  <Text style={styles.error}>{error ?? 'Payment failed. Please try again.'}</Text>
                  <View style={styles.actionRow}>
                    <Pressable style={[styles.actionBtn, styles.retryBtn]} onPress={() => pay(request.method!)}>
                      <Text style={styles.retryText}>Try again</Text>
                    </Pressable>
                    <Pressable style={[styles.actionBtn, styles.cancelBtn]} onPress={close}>
                      <Text style={styles.cancelText}>Cancel</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <ActivityIndicator color={Colors.primary} />
              )}
            </View>
          ) : (
            <>
              {/* Pay with wallet */}
              <Pressable
                style={[styles.option, !walletCovers && styles.optionDim]}
                onPress={() => walletCovers && pay('wallet')}
                disabled={!walletCovers}
              >
                <View style={styles.optIcon}><Wallet size={22} color={Colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optTitle}>Pay with wallet</Text>
                  <Text style={styles.optSub}>
                    {walletLoading ? 'Checking balance…' : `Balance: ${naira(walletKobo)}`}
                    {!walletLoading && !walletCovers ? '  •  insufficient' : ''}
                  </Text>
                </View>
              </Pressable>

              {/* Pay with card / transfer via the Paystack gateway SDK */}
              <Pressable style={styles.option} onPress={() => pay('card')}>
                <View style={styles.optIcon}><CreditCard size={22} color={Colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optTitle}>Pay with Card / Transfer</Text>
                  <Text style={styles.optSub}>Card, bank transfer or USSD via Paystack</Text>
                </View>
              </Pressable>

              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Text style={styles.secure}>Payments are processed securely. Amounts are in Naira.</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
    {/* Paystack gateway host — native shows the checkout WebView; web renders nothing. */}
    <GatewaySheet />
  </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 32, gap: 12,
  },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '700', color: Colors.onSurface },
  amount: { fontSize: 30, fontWeight: '800', color: Colors.primary, marginBottom: 4 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: 16,
    padding: 16, backgroundColor: Colors.surfaceContainerLow,
  },
  optionDim: { opacity: 0.55 },
  optIcon: {
    width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerHigh,
  },
  optTitle: { fontSize: 15, fontWeight: '700', color: Colors.onSurface },
  optSub: { fontSize: 13, color: Colors.onSurfaceVariant, marginTop: 2 },
  busy: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  busyText: { fontSize: 15, fontWeight: '600', color: Colors.onSurface },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  actionBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  retryBtn: { backgroundColor: Colors.primary },
  retryText: { fontSize: 15, fontWeight: '700', color: Colors.surfaceContainerLowest },
  cancelBtn: { borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow },
  cancelText: { fontSize: 15, fontWeight: '700', color: Colors.onSurface },
  hint: { fontSize: 13, color: Colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: 12 },
  error: { color: Colors.error, fontSize: 13, marginTop: 4 },
  secure: { fontSize: 12, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 },
});
