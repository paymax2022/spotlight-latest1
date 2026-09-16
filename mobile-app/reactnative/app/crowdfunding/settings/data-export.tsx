import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';

export default function DataExportScreen() {
  const [requested, setRequested] = useState(false);

  if (requested) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Export my data" showBack={false} />
        <StateView kind="empty" icon="MailCheck" title="Request received" message="We'll email a downloadable copy of your data to your registered address within 48 hours." actionLabel="Done" onAction={() => goBack('/crowdfunding/settings')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Export my data" />
      <View style={styles.body}>
        <View style={styles.iconBox}><Download size={28} color={Colors.primary} strokeWidth={1.8} /></View>
        <Text style={styles.title}>Download your data</Text>
        <Text style={styles.sub}>Request a copy of your profile, campaigns, contributions, and transaction history. We'll prepare a file and email it to you.</Text>
      </View>
      <View style={styles.footer}>
        <PrimaryButton label="Request data export" onPress={() => setRequested(true)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md },
});
