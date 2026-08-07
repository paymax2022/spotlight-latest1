import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import * as Icons from 'lucide-react-native';
import { LogOut, Trash2, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';

interface Row { icon: string; label: string; to?: string; onPress?: () => void }

export default function SettingsHub() {
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: 'Account',
      rows: [
        { icon: 'UserRound', label: 'Profile', to: '/association/profile' },
        { icon: 'ShieldCheck', label: 'Privacy', to: '/association/profile/privacy' },
        { icon: 'Bell', label: 'Notifications', to: '/association/settings/notifications' },
      ],
    },
    {
      title: 'Security',
      rows: [
        { icon: 'Lock', label: 'Security & login', to: '/association/settings/security' },
        { icon: 'Smartphone', label: 'Devices', to: '/association/settings/devices' },
      ],
    },
    {
      title: 'Preferences',
      rows: [
        { icon: 'Languages', label: 'Language', to: '/association/settings/language' },
        { icon: 'Palette', label: 'Theme', to: '/association/settings/theme' },
      ],
    },
    {
      title: 'Support',
      rows: [
        { icon: 'LifeBuoy', label: 'Help center', to: '/association/support' },
        { icon: 'MessageSquare', label: 'My support tickets', to: '/association/support/tickets' },
        { icon: 'FileText', label: 'Terms & privacy', onPress: () => alertAsync({ title: 'Terms & privacy', message: 'Opens the policy documents in the document vault.' }) },
      ],
    },
  ];

  const confirmLogout = async () => {
    const ok = await confirmAsync({ title: 'Log out', message: 'Are you sure you want to log out?', confirmLabel: 'Log out', destructive: true });
    if (!ok) return;
    router.replace('/association');
  };

  const confirmDelete = async () => {
    const ok = await confirmAsync({ title: 'Delete account', message: 'This permanently deletes your membership data. This cannot be undone.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    alertAsync({ title: 'Request submitted', message: 'Account deletion is not available in this preview build.' });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Settings" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {groups.map((g) => (
          <View key={g.title} style={styles.group}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            <View style={[styles.card, shadow1]}>
              {g.rows.map((r, i) => {
                const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[r.icon] ?? Icons.Circle;
                return (
                  <Pressable
                    key={r.label}
                    style={[styles.row, i > 0 && styles.rowDivider]}
                    onPress={r.onPress ?? (() => r.to && router.push(r.to as never))}
                    accessibilityRole="button"
                    accessibilityLabel={r.label}
                  >
                    <View style={styles.rowIcon}><Icon size={18} color={Colors.primary} strokeWidth={2} /></View>
                    <Text style={styles.rowLabel}>{r.label}</Text>
                    <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {/* Danger zone */}
        <View style={styles.group}>
          <View style={[styles.card, shadow1]}>
            <Pressable style={styles.row} onPress={confirmLogout} accessibilityRole="button" accessibilityLabel="Log out">
              <View style={styles.rowIcon}><LogOut size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /></View>
              <Text style={styles.rowLabel}>Log out</Text>
            </Pressable>
            <Pressable style={[styles.row, styles.rowDivider]} onPress={confirmDelete} accessibilityRole="button" accessibilityLabel="Delete account">
              <View style={[styles.rowIcon, styles.rowIconDanger]}><Trash2 size={18} color={Colors.error} strokeWidth={2} /></View>
              <Text style={[styles.rowLabel, { color: Colors.error }]}>Delete account</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.version}>Spotlight Associations · v1.0 (preview)</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md, paddingTop: Spacing.sm },
  group: { gap: Spacing.sm },
  groupTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  rowIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowIconDanger: { backgroundColor: Colors.errorContainer },
  rowLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  version: { ...Typography.caption, color: Colors.outline, textAlign: 'center', marginTop: Spacing.sm },
});
