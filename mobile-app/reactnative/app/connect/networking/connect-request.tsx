import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, Handshake } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useSendConnectRequest } from '@/features/connect/networking/hooks';

/**
 * Request-to-connect note composer (PRD §10.3 NW-04 / SAFETY §5).
 * Sending a request NEVER opens a thread — messaging unlocks only after the
 * recipient accepts (handled by the messaging requests screen).
 */
export default function ConnectRequestScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const profileId = String(id ?? '');
  const displayName = String(name ?? 'this person');

  const [note, setNote] = useState('');
  const send = useSendConnectRequest();
  const [sent, setSent] = useState(false);

  function onSend() {
    send.mutate(
      { profileId, note: note.trim() },
      {
        onSuccess: () => {
          setSent(true);
          setTimeout(() => router.back(), 1100);
        },
      },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Connect" subtitle={displayName} />

      {sent ? (
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Request sent"
          message={`We've sent your request to ${displayName}. You can message once they accept.`}
        />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.intro}>
              <View style={styles.introIcon}>
                <Handshake size={22} color={ConnectColors.brand} strokeWidth={2} />
              </View>
              <Text style={styles.introTitle}>Send a connection request</Text>
              <Text style={styles.introBody}>
                They'll get your request — you can message once they accept.
              </Text>
            </View>

            <TextInputField
              label="Add a note (optional)"
              value={note}
              onChangeText={setNote}
              placeholder="Say why you'd like to connect…"
              multiline
              numberOfLines={5}
              maxLength={300}
              style={styles.noteInput}
            />

            {send.isError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>Couldn't send your request. Please try again.</Text>
              </View>
            ) : null}

            <View style={{ height: Spacing.xl }} />
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label="Send request"
              onPress={onSend}
              loading={send.isPending}
              disabled={!profileId}
            />
            {send.isError ? (
              <PrimaryButton label="Retry" variant="ghost" onPress={onSend} />
            ) : null}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  intro: { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  introIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  introTitle: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  introBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  noteInput: { minHeight: 110, textAlignVertical: 'top' },
  errorBox: {
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  errorText: { ...Typography.labelMd, color: Colors.error },
  footer: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
    gap: Spacing.xs,
  },
});
