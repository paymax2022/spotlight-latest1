// Native implementation of the Paystack gateway — runs the same Paystack v2
// Inline SDK inside a react-native-webview, so iOS/Android get the identical
// checkout popup as web with no server round-trip. Success/cancel/error are
// relayed from the page via window.ReactNativeWebView.postMessage.
//
// Requires `react-native-webview` (Expo: `npx expo install react-native-webview`).
// It is required lazily so the web bundle and tsc never hard-depend on it.

import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import {
  PAYSTACK_PUBLIC_KEY,
  buildPaystackMetadata,
  type PaystackChargeArgs,
  type PaystackGatewayController,
} from './paystackGateway';

// Lazy require keeps this native-only module out of the web bundle and out of
// tsc's module graph (it is typed as any until the package is installed).
let WebView: React.ComponentType<any> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  WebView = require('react-native-webview').WebView;
} catch {
  WebView = null;
}

function buildCheckoutHtml(args: {
  key: string;
  email: string;
  amountKobo: number;
  reference: string;
  metadata: Record<string, unknown>;
}): string {
  return `<!doctype html>
<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" /></head>
  <body style="margin:0;background:#F8F9FF">
    <script src="https://js.paystack.co/v2/inline.js"></script>
    <script>
      function post(m){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
      window.onload = function () {
        try {
          var popup = new PaystackPop();
          popup.newTransaction({
            key: ${JSON.stringify(args.key)},
            email: ${JSON.stringify(args.email)},
            amount: ${Math.round(args.amountKobo)},
            currency: 'NGN',
            reference: ${JSON.stringify(args.reference)},
            metadata: ${JSON.stringify(args.metadata)},
            onSuccess: function (t) { post({ type: 'success', reference: t.reference }); },
            onCancel: function () { post({ type: 'cancel' }); },
            onError: function (e) { post({ type: 'error', message: (e && e.message) || 'Payment error' }); }
          });
        } catch (err) { post({ type: 'error', message: String(err) }); }
      };
    </script>
  </body>
</html>`;
}

export function usePaystackGateway(): PaystackGatewayController {
  const [visible, setVisible] = useState(false);
  const [html, setHtml] = useState('');
  const argsRef = useRef<PaystackChargeArgs | null>(null);

  const open = useCallback((args: PaystackChargeArgs) => {
    if (!PAYSTACK_PUBLIC_KEY) {
      args.onError?.('Paystack key missing — set EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY.');
      return;
    }
    if (!WebView) {
      args.onError?.('Paystack WebView unavailable — run: npx expo install react-native-webview');
      return;
    }
    argsRef.current = args;
    setHtml(
      buildCheckoutHtml({
        key: PAYSTACK_PUBLIC_KEY,
        email: args.email,
        amountKobo: args.amountKobo,
        reference: args.reference ?? '',
        metadata: buildPaystackMetadata(args),
      }),
    );
    setVisible(true);
  }, []);

  const finish = useCallback((handler: (a: PaystackChargeArgs) => void) => {
    const a = argsRef.current;
    setVisible(false);
    if (a) handler(a);
  }, []);

  const onMessage = useCallback(
    (raw: string) => {
      let msg: { type?: string; reference?: string; message?: string };
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'success') finish((a) => a.onSuccess(msg.reference ?? ''));
      else if (msg.type === 'cancel') finish((a) => a.onCancel?.());
      else if (msg.type === 'error') finish((a) => a.onError?.(msg.message ?? 'Payment error'));
    },
    [finish],
  );

  const cancel = useCallback(() => finish((a) => a.onCancel?.()), [finish]);

  const Sheet = useCallback(() => {
    if (!WebView) return null;
    const WV = WebView;
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={cancel}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.bar}>
            <Pressable onPress={cancel} hitSlop={10}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.title}>Secure payment</Text>
            <View style={{ width: 54 }} />
          </View>
          <WV
            originWhitelist={['*']}
            source={{ html }}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            onMessage={(e: { nativeEvent: { data: string } }) => onMessage(e.nativeEvent.data)}
            renderLoading={() => (
              <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>
            )}
            style={{ flex: 1 }}
          />
        </SafeAreaView>
      </Modal>
    );
  }, [visible, html, cancel, onMessage]);

  return { open, Sheet };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh,
  },
  cancel: { ...Typography.labelMd, color: Colors.primary, width: 54 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
