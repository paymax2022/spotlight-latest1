// ── Account tab (§ Trust & Account hub, screens 28–34) ───────────────────────
// The Account tab is the hub that links every Trust & Account surface:
//   28 Verification Center → reuses the existing KYC flow shell (/kyc-verify)
//   30 Wallet hand-off     → reuses the existing wallet screen (/(tabs)/wallet)
//   31 Report flow         → account/report
//   32 Blocked users       → account/blocked
//   33 Notification prefs   → account/notifications
//   34 Help & Support       → account/help
// plus the Discover-owned Saved items / Saved searches (linked, not owned here).
//
// (29 My Orders is owned by the Transact agent — reachable from the Orders tab.)
//
// Data layer: @/features/marketplace/api/account.api (mock/live via MKT_USE_MOCK).
import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ShieldCheck, Wallet, Heart, BellRing, Bell, Flag, UserX, LifeBuoy, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '@/features/marketplace';

type Row = {
  key: string;
  label: string;
  sub: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  route: string;
  tint?: string;
};

type Section = { title: string; rows: Row[] };

const SECTIONS: Section[] = [
  {
    title: 'Trust & safety',
    rows: [
      { key: 'verify', label: 'Verification center', sub: 'Progress your trust badge — higher limits, more reach', icon: ShieldCheck, route: '/kyc-verify' },
      { key: 'report', label: 'Report a problem', sub: 'Flag a listing, seller, or chat — always available', icon: Flag, route: '/marketplace/account/report' },
      { key: 'blocked', label: 'Blocked users', sub: 'Manage who can contact you', icon: UserX, route: '/marketplace/account/blocked' },
    ],
  },
  {
    title: 'Money',
    rows: [
      { key: 'wallet', label: 'Wallet', sub: 'Top up or withdraw without leaving marketplace', icon: Wallet, route: '/(tabs)/wallet' },
    ],
  },
  {
    title: 'Activity',
    rows: [
      { key: 'saved', label: 'Saved items', sub: 'Your wishlist', icon: Heart, route: '/marketplace/saved-items' },
      { key: 'searches', label: 'Saved searches', sub: 'Alerts when new listings match', icon: BellRing, route: '/marketplace/saved-searches' },
    ],
  },
  {
    title: 'Preferences & help',
    rows: [
      { key: 'notifs', label: 'Notification preferences', sub: 'Choose exactly what you hear about', icon: Bell, route: '/marketplace/account/notifications' },
      { key: 'help', label: 'Help & support', sub: 'Escrow, disputes, fees — and contact us', icon: LifeBuoy, route: '/marketplace/account/help' },
    ],
  },
];

export default function AccountTab() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.header}>Account</Text>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.card}>
              {section.rows.map((r, i) => {
                const Icon = r.icon;
                return (
                  <Pressable
                    key={r.key}
                    style={[styles.row, i > 0 && styles.rowDivider]}
                    onPress={() => router.push(r.route as never)}
                    accessibilityRole="button"
                    accessibilityLabel={r.label}
                  >
                    <View style={styles.rowIcon}><Icon size={20} color={MarketColors.brand} /></View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowLabel}>{r.label}</Text>
                      <Text style={styles.rowSub}>{r.sub}</Text>
                    </View>
                    <ChevronRight size={18} color={MarketColors.muted} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        <Text style={styles.footNote}>Your trust badge is never boost-gated — verification is the only path.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { ...Typography.headlineMd, color: Colors.onSurface, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.lg },
  section: { gap: Spacing.xs },
  sectionTitle: { ...Typography.labelSm, color: MarketColors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginLeft: Spacing.xs },
  card: { backgroundColor: MarketColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: MarketColors.border },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  rowLabel: { ...Typography.titleMd, color: MarketColors.text },
  rowSub: { ...Typography.labelSm, color: MarketColors.muted, marginTop: 1 },
  footNote: { ...Typography.labelSm, color: MarketColors.muted, textAlign: 'center', marginTop: Spacing.md },
});
