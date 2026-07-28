import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useActivity } from '@/features/fx/hooks/useFxAccount';
import { relativeTime } from '@/features/fx/utils/fxFormatters';
import type { ActivityEvent } from '@/features/fx/types/fx.types';

const KIND_ICON: Record<ActivityEvent['kind'], { icon: string; color: string; bg: string }> = {
  auth: { icon: 'LogIn', color: Colors.secondary, bg: Colors.iconBgBlue },
  payout: { icon: 'Send', color: Colors.primary, bg: Colors.iconBgPurple },
  config: { icon: 'Settings', color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  approval: { icon: 'CheckCheck', color: Colors.teal, bg: Colors.iconBgTeal },
  security: { icon: 'ShieldCheck', color: Colors.error, bg: Colors.errorContainer },
};

export default function ActivityLogScreen() {
  const { data, isLoading, isError, refetch } = useActivity();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Activity log" subtitle="Audit trail" />
      {isLoading ? <StateView kind="loading" /> : isError ? <StateView kind="error" title="Couldn't load activity" actionLabel="Retry" onAction={() => refetch()} /> : (
        <FlatList
          data={data}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const k = KIND_ICON[item.kind];
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[k.icon] ?? Icons.Circle;
            return (
              <View style={styles.row}>
                <View style={[styles.icon, { backgroundColor: k.bg }]}><Icon size={16} color={k.color} strokeWidth={2} /></View>
                <View style={styles.mid}>
                  <Text style={styles.action}><Text style={styles.actor}>{item.actor}</Text> {item.action.toLowerCase()}{item.target ? ` · ${item.target}` : ''}</Text>
                  <Text style={styles.time}>{relativeTime(item.at)}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center', paddingVertical: Spacing.sm },
  icon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1 },
  action: { ...Typography.bodyMd, color: Colors.onSurface },
  actor: { fontWeight: '700' },
  time: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
});
