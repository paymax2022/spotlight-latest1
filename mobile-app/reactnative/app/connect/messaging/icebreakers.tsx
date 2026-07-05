import React from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Sparkles, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useIcebreakers } from '@/features/connect/messaging/hooks';
import type { Icebreaker } from '@/features/connect/messaging/types';

// MS-04 — Icebreakers. Tapping one navigates back to the thread with the chosen
// text as an `icebreaker` param; thread.tsx reads it on mount and prefills the
// composer (decoupled — this screen never sends).

export default function Icebreakers() {
  const params = useLocalSearchParams<{ threadId?: string }>();
  const threadId = String(params.threadId ?? '');
  const { data, isLoading, error, refetch } = useIcebreakers();

  const choose = (text: string) => {
    router.replace(
      `/connect/messaging/thread?threadId=${threadId}&icebreaker=${encodeURIComponent(text)}`,
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Icebreakers" subtitle="Tap one to start the conversation" />

      {isLoading ? (
        <StateView kind="loading" message="Loading icebreakers…" />
      ) : error ? (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Could not load icebreakers"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : !data || data.length === 0 ? (
        <StateView kind="empty" icon="Sparkles" title="No icebreakers available" />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(i: Icebreaker) => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => choose(item.text)}>
              <View style={styles.iconBox}>
                <Sparkles size={18} color={ConnectColors.brand} strokeWidth={2.2} />
              </View>
              <Text style={styles.cardText}>{item.text}</Text>
              <ChevronRight size={18} color={ConnectColors.muted} />
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  cardText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
});
