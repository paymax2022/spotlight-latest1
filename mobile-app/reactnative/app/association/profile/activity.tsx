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
import { useActivity } from '@/features/association/hooks/useProfile';
import { relativeTime } from '@/features/association/utils/associationFormatters';
import type { ActivityType } from '@/features/association/types/profile.types';

const ICON: Record<ActivityType, string> = {
  payment: 'CreditCard', meeting: 'CalendarDays', task: 'ListTodo',
  document: 'FileText', membership: 'IdCard', profile: 'UserRound',
};

export default function ActivityHistory() {
  const activity = useActivity();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Activity history" />
      {activity.isLoading ? (
        <StateView kind="loading" message="Loading activity…" />
      ) : activity.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => activity.refetch()} />
      ) : (activity.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="History" title="No activity yet" message="Your membership activity will appear here." />
      ) : (
        <FlatList
          data={activity.data ?? []}
          keyExtractor={(a) => a.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => {
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[ICON[item.type]] ?? Icons.Dot;
            const last = index === (activity.data?.length ?? 0) - 1;
            return (
              <View style={styles.row}>
                <View style={styles.railCol}>
                  <View style={styles.iconBox}><Icon size={15} color={Colors.primary} strokeWidth={2} /></View>
                  {!last ? <View style={styles.rail} /> : null}
                </View>
                <View style={styles.content}>
                  <Text style={styles.text}>{item.text}</Text>
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
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 120 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  railCol: { alignItems: 'center', width: 32 },
  iconBox: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rail: { width: 2, flex: 1, backgroundColor: Colors.outlineVariant, marginVertical: 2 },
  content: { flex: 1, paddingBottom: Spacing.lg },
  text: { ...Typography.bodyMd, color: Colors.onSurface },
  time: { ...Typography.caption, color: Colors.outline, marginTop: 2 },
});
