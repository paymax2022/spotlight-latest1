import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { TeleHeader } from '@/features/telemedicine/components';
import { EdgeStateView } from '@/features/doctor/components';

// ── Section AD — Access-denied gate (AD.24) ───────────────────────────────────
// Dedicated full-screen gate rendering the access_denied descriptor via the
// shared EdgeStateView. The primary CTA goes back.

export default function AccessDeniedScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Access Denied" />
      <EdgeStateView kind="access_denied" onPrimary={() => goBack('/account-status')} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
});
