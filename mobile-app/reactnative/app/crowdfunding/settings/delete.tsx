import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { TriangleAlert, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';

const CONSEQUENCES = [
  'Your campaigns will be unpublished',
  'Active campaigns must be settled or refunded first',
  'Contribution history will be anonymised',
  'This action cannot be undone',
];

export default function DeleteAccountScreen() {
  const [ack, setAck] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Delete account" showBack={false} />
        <StateView kind="empty" icon="MailCheck" title="Deletion request submitted" message="We'll process your request within 30 days as required by law, after settling any open campaigns. You'll receive a confirmation email." actionLabel="Done" onAction={() => router.dismissTo('/crowdfunding/settings')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Delete account" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.warnBox}>
          <TriangleAlert size={26} color={Colors.error} strokeWidth={2} />
          <Text style={styles.warnTitle}>This is permanent</Text>
        </View>
        <Text style={styles.intro}>Before you delete your account, please understand:</Text>
        <View style={styles.list}>
          {CONSEQUENCES.map((c) => (
            <View key={c} style={styles.listRow}>
              <View style={styles.bullet} />
              <Text style={styles.listText}>{c}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.ackRow} onPress={() => setAck((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: ack }}>
          <View style={[styles.checkbox, ack && styles.checkboxOn]}>{ack && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}</View>
          <Text style={styles.ackText}>I understand this is permanent and want to delete my account.</Text>
        </Pressable>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          onPress={() => ack && setDone(true)}
          disabled={!ack}
          style={[styles.deleteBtn, !ack && styles.deleteBtnDisabled]}
          accessibilityRole="button"
        >
          <Text style={styles.deleteText}>Delete my account</Text>
        </Pressable>
        <PrimaryButton label="Cancel" variant="ghost" onPress={() => goBack('/crowdfunding/settings')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  warnBox: { alignItems: 'center', gap: 6, paddingVertical: Spacing.md },
  warnTitle: { ...Typography.titleLg, color: Colors.error },
  intro: { ...Typography.bodyMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  list: { gap: Spacing.sm },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  bullet: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: Colors.error, marginTop: 7 },
  listText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1 },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.lg },
  checkbox: { width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: Colors.error, borderColor: Colors.error },
  ackText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, gap: Spacing.xs },
  deleteBtn: { height: 56, borderRadius: Radius.lg, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  deleteBtnDisabled: { opacity: 0.5 },
  deleteText: { ...Typography.labelLg, color: Colors.onError },
});
