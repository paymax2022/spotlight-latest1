import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { UserPlus, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';

/** Viewer requests to co-host / join as guest (PRD §10.6 LV-05). */
export default function CoHostRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [requested, setRequested] = useState(false);
  const [sending, setSending] = useState(false);

  function submit() {
    setSending(true);
    setTimeout(() => { setSending(false); setRequested(true); }, 600);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Request to co-host" />
      <View style={styles.body}>
        <View style={styles.iconCircle}>
          {requested ? (
            <CircleCheck size={36} color={ConnectColors.ok} strokeWidth={2} />
          ) : (
            <UserPlus size={36} color={ConnectColors.brand} strokeWidth={2} />
          )}
        </View>
        {requested ? (
          <>
            <Text style={styles.title}>Request sent</Text>
            <Text style={styles.sub}>The host will see your request. You'll be notified if you're invited to join the stream.</Text>
            <View style={styles.btnWrap}><PrimaryButton label="Back to stream" onPress={() => router.back()} /></View>
          </>
        ) : (
          <>
            <Text style={styles.title}>Join the stream?</Text>
            <Text style={styles.sub}>
              Ask the host to bring you on as a co-host. They can accept or decline. Your camera and mic stay off until the host accepts and you confirm.
            </Text>
            <View style={styles.noteBox}>
              <Text style={styles.note}>Co-hosting puts you on camera. Be sure you're ready to appear publicly — your video is moderated like any stream.</Text>
            </View>
            <View style={styles.btnWrap}>
              <PrimaryButton label={sending ? 'Sending…' : 'Send request'} loading={sending} onPress={submit} />
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  noteBox: { backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  note: { ...Typography.caption, color: Colors.onWarning, textAlign: 'center' },
  btnWrap: { width: '100%', marginTop: Spacing.lg },
});
