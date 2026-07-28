import React from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ChatThreadRow from '@/features/association/components/ChatThreadRow';
import { useChatThreads } from '@/features/association/hooks/useChat';

export default function ChatInbox() {
  const threads = useChatThreads();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Chat" />
      {threads.isLoading ? (
        <StateView kind="loading" message="Loading conversations…" />
      ) : threads.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => threads.refetch()} />
      ) : (threads.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="MessageCircle" title="No conversations yet" message="Your chapter and committee chats will appear here." />
      ) : (
        <FlatList
          data={threads.data ?? []}
          keyExtractor={(t) => t.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <ChatThreadRow thread={item} onPress={() => router.push(`/association/chat/${item.id}`)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120 },
  sep: { height: 1, backgroundColor: Colors.outlineVariant, opacity: 0.5 },
});
