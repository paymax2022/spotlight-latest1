import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LogOut } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SettingsList, { SettingsGroupDef } from '@/features/connect/components/SettingsList';
import { usePremiumStatus } from '@/features/connect/hooks/useConnect';

// ST-02 — Settings root. Mirrors crowdfunding/settings/index.tsx hub pattern.
export default function SettingsHub() {
  const [logout, setLogout] = useState(false);
  const { data: premium } = usePremiumStatus();

  const groups: SettingsGroupDef[] = [
    {
      title: 'Account',
      rows: [
        { icon: 'UserRound', label: 'Account settings', sub: 'Identity & linked Paymax account', href: '/connect/settings/account' },
        { icon: 'Lock', label: 'Privacy & visibility', sub: 'Per-mode visibility, blocked list', href: '/connect/settings/privacy' },
        { icon: 'Bell', label: 'Notifications', sub: 'Channels & topics', href: '/connect/settings/notifications' },
      ],
    },
    {
      title: 'Safety & support',
      rows: [
        { icon: 'ShieldCheck', label: 'Safety center', sub: 'Tips, blocked users, report history', href: '/connect/settings/safety-center' },
        { icon: 'Siren', label: 'Date safety & SOS', sub: 'Share trips, emergency contacts', href: '/connect/settings/date-safety-sos' },
        { icon: 'Flag', label: 'Report a problem', href: '/connect/settings/report' },
        { icon: 'Gavel', label: 'Appeal a strike', sub: 'Submit & track an appeal', href: '/connect/settings/appeal' },
        { icon: 'Headphones', label: 'Help & support', sub: 'FAQ, contact, tickets', href: '/connect/settings/help' },
      ],
    },
    {
      title: 'Preferences',
      rows: [
        { icon: 'Languages', label: 'Language', sub: 'English, Pidgin, Hausa, Yoruba, Igbo', href: '/connect/settings/language' },
        { icon: 'Gauge', label: 'Data saver', sub: 'Quality & data controls', href: '/connect/settings/data-saver' },
        { icon: 'Crown', label: 'Premium', sub: premium?.active ? 'Active' : 'Plans & boosts', href: '/connect/settings/premium', badge: premium?.active ? 'Plus' : undefined },
      ],
    },
    {
      title: 'About',
      rows: [
        { icon: 'Scale', label: 'Legal', sub: 'Terms, privacy (NDPA), guidelines', href: '/connect/settings/legal' },
        { icon: 'Trash2', label: 'Delete account', danger: true, href: '/connect/settings/delete-account' },
      ],
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Settings" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <SettingsList groups={groups} />

        <Pressable style={styles.logoutRow} onPress={() => setLogout(true)} accessibilityRole="button">
          <LogOut size={18} color={Colors.error} strokeWidth={2} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
        <Text style={styles.version}>Paymax Connect · v1.0.0</Text>
      </ScrollView>

      <Modal visible={logout} transparent animationType="fade" onRequestClose={() => setLogout(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Log out?</Text>
            <Text style={styles.sheetBody}>You'll need to sign in again to use Connect.</Text>
            <View style={styles.sheetActions}>
              <PrimaryButton label="Log out" onPress={() => { setLogout(false); router.replace('/(auth)/login'); }} />
              <PrimaryButton label="Cancel" variant="ghost" onPress={() => setLogout(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  logoutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.xl, paddingVertical: Spacing.md },
  logoutText: { ...Typography.labelLg, color: Colors.error },
  version: { ...Typography.caption, color: Colors.outline, textAlign: 'center', marginTop: Spacing.sm },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sheetBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  sheetActions: { marginTop: Spacing.sm, gap: Spacing.xs },
});
