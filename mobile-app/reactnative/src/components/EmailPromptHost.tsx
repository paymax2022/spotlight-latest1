// Mounted once at the app root. Renders the "enter your email" prompt that
// promptEmailAsync (src/lib/emailPrompt.ts) queues — shown when the backend
// answers a checkout with 422 email_required because the account has no email
// Paystack will accept. Styled with the app design tokens (mirrors ConfirmHost).
// Unlike ConfirmHost this renders on native too: Alert.alert has no text field
// on Android or web.

import React, { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Colors, Typography, Radius, Spacing, shadow3 } from '@/constants/tokens';
import { subscribeEmailPrompt, resolveEmailPrompt, type EmailPromptRequest } from '@/lib/emailPrompt';
import { isBillableEmail } from '@/features/payments/billingEmail';

export default function EmailPromptHost() {
  const [queue, setQueue] = useState<EmailPromptRequest[]>([]);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => subscribeEmailPrompt(setQueue), []);

  const req = queue[0];
  const reqId = req?.id;
  const initial = req?.initialValue ?? '';

  // Each new prompt starts from its own prefill with no stale error.
  useEffect(() => {
    setValue(initial);
    setError('');
  }, [reqId, initial]);

  const submit = () => {
    if (!req) return;
    const email = value.trim();
    if (!isBillableEmail(email)) {
      setError('Enter a valid email address, for example name@gmail.com.');
      return;
    }
    resolveEmailPrompt(req.id, email);
  };
  const cancel = () => req && resolveEmailPrompt(req.id, null);

  return (
    <Modal visible={!!req} transparent animationType="fade" onRequestClose={cancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={cancel} accessibilityRole="button" accessibilityLabel="Dismiss" />
        {req ? (
          <View style={[styles.dialog, shadow3]} accessibilityViewIsModal>
            <Text style={styles.title}>{req.title}</Text>
            {req.message ? <Text style={styles.message}>{req.message}</Text> : null}
            <TextInput
              value={value}
              onChangeText={(t) => {
                setValue(t);
                if (error) setError('');
              }}
              placeholder="name@example.com"
              placeholderTextColor={Colors.onSurfaceVariant}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="done"
              onSubmitEditing={submit}
              autoFocus
              accessibilityLabel="Email address"
              style={[styles.input, !!error && styles.inputError]}
            />
            {error ? (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Pressable onPress={cancel} style={[styles.btn, styles.cancelBtn]} accessibilityRole="button">
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
              <Pressable onPress={submit} style={[styles.btn, styles.confirmBtn]} accessibilityRole="button">
                <Text style={styles.confirmLabel}>{req.confirmLabel}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  dialog: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  message: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  input: {
    ...Typography.bodyMd,
    color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputError: { borderColor: Colors.error },
  error: { ...Typography.bodySm, color: Colors.error },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm, marginTop: Spacing.md },
  btn: { minWidth: 96, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { backgroundColor: Colors.surfaceContainerHigh },
  confirmBtn: { backgroundColor: Colors.primary },
  cancelLabel: { ...Typography.labelLg, color: Colors.onSurface },
  confirmLabel: { ...Typography.labelLg, color: Colors.onPrimary },
});
