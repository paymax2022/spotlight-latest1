import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ChevronRight, LogOut } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';

type Row = { icon: string; label: string; sub?: string; href?: string; danger?: boolean };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  { title: 'Account', rows: [
    { icon: 'UserRound', label: 'Profile settings', sub: 'Name, photo, contact', href: '/crowdfunding/settings/profile' },
    { icon: 'BadgeCheck', label: 'Verification', sub: 'KYC / KYB status', href: '/crowdfunding/settings/verification' },
  ]},
  { title: 'Payments', rows: [
    { icon: 'Landmark', label: 'Bank accounts', sub: 'For withdrawals', href: '/crowdfunding/settings/bank-accounts' },
    { icon: 'CreditCard', label: 'Payment methods', sub: 'Saved cards', href: '/crowdfunding/settings/payment' },
  ]},
  { title: 'Preferences', rows: [
    { icon: 'Bell', label: 'Notifications', sub: 'Push, email, SMS', href: '/crowdfunding/settings/notifications' },
    { icon: 'Languages', label: 'Language', sub: 'English (NG)', href: '/crowdfunding/settings/language' },
    { icon: 'Palette', label: 'Theme', sub: 'Light', href: '/crowdfunding/settings/theme' },
  ]},
  { title: 'Security & privacy', rows: [
    { icon: 'ShieldCheck', label: 'Security', sub: 'Password, biometrics, 2FA', href: '/crowdfunding/settings/security' },
    { icon: 'Lock', label: 'Privacy', sub: 'Data & visibility', href: '/crowdfunding/settings/privacy' },
    { icon: 'Download', label: 'Export my data', href: '/crowdfunding/settings/data-export' },
    { icon: 'Trash2', label: 'Delete account', danger: true, href: '/crowdfunding/settings/delete' },
  ]},
];

export default function SettingsHub() {
  const [logout, setLogout] = useState(false);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Settings" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {GROUPS.map((g) => (
          <View key={g.title} style={styles.group}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            <View style={styles.card}>
              {g.rows.map((r, i, arr) => {
                const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[r.icon] ?? Icons.Circle;
                return (
                  <Pressable
                    key={r.label}
                    style={[styles.row, i < arr.length - 1 && styles.rowBorder]}
                    onPress={() => r.href && router.push(r.href as never)}
                    accessibilityRole="button"
                    accessibilityLabel={r.label}
                  >
                    <View style={[styles.rowIcon, r.danger && styles.rowIconDanger]}>
                      <Icon size={18} color={r.danger ? Colors.error : Colors.primary} strokeWidth={2} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowLabel, r.danger && styles.rowLabelDanger]}>{r.label}</Text>
                      {r.sub ? <Text style={styles.rowSub}>{r.sub}</Text> : null}
                    </View>
                    <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <Pressable style={styles.logoutRow} onPress={() => setLogout(true)} accessibilityRole="button">
          <LogOut size={18} color={Colors.error} strokeWidth={2} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
        <Text style={styles.version}>Spotlight Crowdfunding · v1.0.0</Text>
      </ScrollView>

      {/* Logout confirmation */}
      <Modal visible={logout} transparent animationType="fade" onRequestClose={() => setLogout(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Log out?</Text>
            <Text style={styles.sheetBody}>You'll need to sign in again to manage your campaigns and contributions.</Text>
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
  group: { marginTop: Spacing.lg },
  groupTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowIconDanger: { backgroundColor: Colors.iconBgRed },
  rowBody: { flex: 1 },
  rowLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rowLabelDanger: { color: Colors.error },
  rowSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  logoutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.xl, paddingVertical: Spacing.md },
  logoutText: { ...Typography.labelLg, color: Colors.error },
  version: { ...Typography.caption, color: Colors.outline, textAlign: 'center', marginTop: Spacing.sm },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sheetBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  sheetActions: { marginTop: Spacing.sm, gap: Spacing.xs },
});
