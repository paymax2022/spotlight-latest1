import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ElectionHeaderBanner from '@/features/election/components/ElectionHeaderBanner';

interface Notif {
  id: string; title: string; body: string;
  icon: string; iconColor: string; bgColor: string;
  time: string; read: boolean; group: 'Today' | 'Earlier';
}

const NOTIFS: Notif[] = [
  { id:'1', title:'₦350,000 Credit Alert', body:'Salary received from ACME Corp', icon:'ArrowDownLeft', iconColor:Colors.teal, bgColor:Colors.iconBgTeal, time:'8:00 AM', read:false, group:'Today' },
  { id:'2', title:'Airtime Purchase',       body:'₦500 airtime for 09012345678',  icon:'Smartphone',  iconColor:Colors.primary, bgColor:Colors.iconBgPurple, time:'9:41 AM', read:false, group:'Today' },
  { id:'3', title:'Spotlight Contest',      body:'New voting round is now live!', icon:'BarChart3',    iconColor:Colors.secondary, bgColor:Colors.iconBgBlue, time:'11:00 AM', read:true, group:'Today' },
  { id:'4', title:'Investment Return',      body:'₦12,500 returned to your wallet',icon:'TrendingUp', iconColor:'#16A34A', bgColor:'rgba(22,163,74,0.08)', time:'Yesterday', read:true, group:'Earlier' },
  { id:'5', title:'Bill Payment Successful',body:'EKEDC electricity — ₦7,500',   icon:'Zap',         iconColor:'#EAB308', bgColor:'rgba(234,179,8,0.10)', time:'2 Jun', read:true, group:'Earlier' },
  { id:'6', title:'New Feature: FX Exchange',body:'Send money to 40+ countries',  icon:'Globe',       iconColor:Colors.secondary, bgColor:Colors.iconBgBlue, time:'1 Jun', read:true, group:'Earlier' },
];

function NotifItem({ n }: { n: Notif }) {
  const IconComp = (Icons as unknown as Record<string, Icons.LucideIcon>)[n.icon] ?? Icons.Bell;
  return (
    <View style={[styles.item, !n.read && styles.unread]}>
      <View style={[styles.iconBox, { backgroundColor: n.bgColor }]}>
        <IconComp size={20} color={n.iconColor} strokeWidth={1.8} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.notifTitle}>{n.title}</Text>
          {!n.read && <View style={styles.dot} />}
        </View>
        <Text style={styles.notifBody}>{n.body}</Text>
        <Text style={styles.time}>{n.time}</Text>
      </View>
    </View>
  );
}

export default function NotificationsScreen() {
  const todayNotifs   = NOTIFS.filter((n) => n.group === 'Today');
  const earlierNotifs = NOTIFS.filter((n) => n.group === 'Earlier');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        <Text style={styles.unreadCount}>{NOTIFS.filter((n) => !n.read).length} unread</Text>
      </View>

      <ElectionHeaderBanner />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 100 : 80 }}>
        {[{ label: 'Today', items: todayNotifs }, { label: 'Earlier', items: earlierNotifs }].map(({ label, items }) => (
          items.length > 0 && (
            <View key={label} style={styles.group}>
              <Text style={styles.groupLabel}>{label}</Text>
              <View style={[styles.card, shadow1]}>
                {items.map((n, i) => (
                  <View key={n.id}>
                    <NotifItem n={n} />
                    {i < items.length - 1 && <View style={styles.divider} />}
                  </View>
                ))}
              </View>
            </View>
          )
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title:  { ...Typography.headlineMd, color: Colors.onSurface },
  unreadCount: { ...Typography.labelSm, color: Colors.secondary, backgroundColor: Colors.secondaryFixed, paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  group:  { marginBottom: Spacing.lg },
  groupLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  card:   { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, marginHorizontal: Spacing.containerMargin, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  item:   { flexDirection: 'row', gap: Spacing.md, padding: Spacing.md },
  unread: { backgroundColor: Colors.surfaceContainerLow },
  iconBox:{ width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  body:   { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: 2 },
  notifTitle: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  dot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.secondary },
  notifBody: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: 4 },
  time:   { ...Typography.caption, color: Colors.outline },
  divider:{ height: 1, backgroundColor: Colors.surfaceContainerHigh },
});
