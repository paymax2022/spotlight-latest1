import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Send, ArrowLeftRight, ArrowDownLeft, TrendingUp, ShieldCheck, CheckCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ToggleRow from '@/features/doctor/components/ToggleRow';
import { useSettings, useUpdateNotificationPrefs } from '@/features/fx/hooks/useFxAccount';
import type { NotificationPrefs } from '@/features/fx/types/fx.types';

export default function NotificationPrefsScreen() {
  const { data, isLoading } = useSettings();
  const update = useUpdateNotificationPrefs();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => { if (data && !prefs) setPrefs(data.notifications); }, [data, prefs]);

  const set = (patch: Partial<NotificationPrefs>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    update.mutate(next);
  };

  if (isLoading || !prefs) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Notifications" /><StateView kind="loading" /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notification preferences" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.group}>
          <ToggleRow label="Payouts" description="Sent, paid, failed or reversed" icon={Send} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} value={prefs.payouts} onValueChange={(v) => set({ payouts: v })} />
          <ToggleRow label="Conversions" description="Conversion settled or failed" icon={ArrowLeftRight} value={prefs.conversions} onValueChange={(v) => set({ conversions: v })} />
          <ToggleRow label="Collections" description="Inbound money received" icon={ArrowDownLeft} iconColor={Colors.teal} bgColor={Colors.iconBgTeal} value={prefs.collections} onValueChange={(v) => set({ collections: v })} />
          <ToggleRow label="Rate alerts" description="When a rate hits your target" icon={TrendingUp} iconColor={Colors.teal} bgColor={Colors.iconBgTeal} value={prefs.rateAlerts} onValueChange={(v) => set({ rateAlerts: v })} />
          <ToggleRow label="Approvals" description="Items awaiting your approval" icon={CheckCheck} value={prefs.approvals} onValueChange={(v) => set({ approvals: v })} />
          <ToggleRow label="Security" description="Sign-ins & sensitive changes" icon={ShieldCheck} iconColor={Colors.error} bgColor={Colors.errorContainer} value={prefs.security} onValueChange={(v) => set({ security: v })} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  group: { gap: Spacing.sm },
});
