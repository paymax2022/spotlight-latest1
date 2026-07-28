import React, { useState } from 'react';
import { View, Text, Switch, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Smartphone, ChevronRight } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useSecuritySettings, useUpdateSecuritySettings } from '@/features/association/hooks/useSettings';

export default function SecuritySettingsScreen() {
  const security = useSecuritySettings();
  const update = useUpdateSecuritySettings();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const value = security.data;
  const canChange = current.length >= 6 && next.length >= 8 && next === confirm;

  const onChangePassword = () => {
    if (!canChange) { Alert.alert('Check your entries', 'New password must be 8+ characters and match the confirmation.'); return; }
    Alert.alert('Password updated', 'Your password has been changed.');
    setCurrent(''); setNext(''); setConfirm('');
  };

  const toggle = (key: 'biometricEnabled' | 'twoFactorEnabled') => { if (value) update.mutate({ ...value, [key]: !value[key] }); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Security & login" />
      {security.isLoading || !value ? (
        <StateView kind="loading" message="Loading…" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Toggles */}
          <View style={[styles.card, shadow1]}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Biometric login</Text>
                <Text style={styles.help}>Use Face ID / fingerprint to sign in.</Text>
              </View>
              <Switch value={value.biometricEnabled} onValueChange={() => toggle('biometricEnabled')} trackColor={{ true: Colors.primary, false: Colors.outlineVariant }} thumbColor={Colors.white} accessibilityLabel="Biometric login" />
            </View>
            <View style={[styles.toggleRow, styles.divider]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Two-factor authentication</Text>
                <Text style={styles.help}>Require a one-time code at sign-in.</Text>
              </View>
              <Switch value={value.twoFactorEnabled} onValueChange={() => toggle('twoFactorEnabled')} trackColor={{ true: Colors.primary, false: Colors.outlineVariant }} thumbColor={Colors.white} accessibilityLabel="Two-factor authentication" />
            </View>
          </View>

          {/* Devices link */}
          <Pressable style={[styles.linkRow, shadow1]} onPress={() => router.push('/association/settings/devices')} accessibilityRole="button" accessibilityLabel="Manage devices">
            <View style={styles.linkIcon}><Smartphone size={18} color={Colors.primary} strokeWidth={2} /></View>
            <Text style={styles.linkLabel}>Manage devices</Text>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>

          {/* Change password */}
          <Text style={styles.sectionTitle}>Change password</Text>
          <TextInputField label="Current password" value={current} onChangeText={setCurrent} secure />
          <TextInputField label="New password" value={next} onChangeText={setNext} secure />
          <TextInputField label="Confirm new password" value={confirm} onChangeText={setConfirm} secure error={confirm.length > 0 && confirm !== next ? 'Passwords do not match' : undefined} />
          <PrimaryButton label="Update password" onPress={onChangePassword} disabled={!canChange} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md, paddingTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  linkIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
});
