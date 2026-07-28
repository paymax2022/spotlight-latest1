import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { TriangleAlert, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useRequestAccountDeletion } from '@/features/connect/hooks/useConnect';

// ST-16 — Delete/deactivate account. Data-deletion flow.
const CONSEQUENCES = [
  'Your profile, matches and conversations are permanently removed.',
  'Any remaining wallet balance must be withdrawn first.',
  'Some records are retained where law or AML rules require.',
  'This cannot be undone once the deletion window closes.',
];

export default function DeleteAccount() {
  const del = useRequestAccountDeletion();
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');

  const canDelete = confirm.trim().toUpperCase() === 'DELETE';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Delete account" />
      {del.isSuccess ? (
        <View style={styles.success}>
          <View style={styles.successIcon}><CircleCheck size={48} color={Colors.teal} strokeWidth={1.6} /></View>
          <Text style={styles.successTitle}>Deletion scheduled</Text>
          <Text style={styles.successBody}>
            Your account is scheduled for deletion on {new Date(del.data.scheduledFor).toLocaleDateString()}.
            Log back in before then to cancel.
          </Text>
          <View style={{ width: '100%', marginTop: Spacing.lg }}>
            <PrimaryButton label="Done" onPress={() => router.replace('/connect/settings')} />
          </View>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <View style={styles.warnCard}>
            <View style={styles.warnIcon}><TriangleAlert size={22} color={Colors.error} strokeWidth={2} /></View>
            <Text style={styles.warnTitle}>This is permanent</Text>
            <Text style={styles.warnBody}>Before you go, here's what happens:</Text>
            {CONSEQUENCES.map((c) => (
              <View key={c} style={styles.consRow}>
                <View style={styles.dot} />
                <Text style={styles.consText}>{c}</Text>
              </View>
            ))}
          </View>

          <TextInputField label="Why are you leaving? (optional)" value={reason} onChangeText={setReason} placeholder="Help us improve" multiline numberOfLines={3} style={styles.reasonInput} />

          <TextInputField label='Type "DELETE" to confirm' value={confirm} onChangeText={setConfirm} placeholder="DELETE" autoCapitalize="characters" />

          <PrimaryButton
            label="Permanently delete my account"
            variant="danger"
            onPress={() => del.mutate(reason.trim() || undefined)}
            disabled={!canDelete}
            loading={del.isPending}
          />
          <PrimaryButton label="Cancel" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md, paddingTop: Spacing.sm },
  warnCard: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  warnIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center' },
  warnTitle: { ...Typography.titleMd, color: Colors.error },
  warnBody: { ...Typography.bodySm, color: Colors.onSurface },
  consRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  dot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: Colors.error, marginTop: 7 },
  consText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  reasonInput: { minHeight: 72, textAlignVertical: 'top' },
  success: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  successIcon: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  successBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
