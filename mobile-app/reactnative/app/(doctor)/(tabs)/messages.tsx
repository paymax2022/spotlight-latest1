import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MessageSquare, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useChatThreads } from '@/features/doctor/hooks';
import { StateView } from '@/features/doctor/components';
import { DoctorAvatar } from '@/features/telemedicine/components';
import type { ChatThread } from '@/types/doctor';

export default function DoctorMessagesScreen() {
  const { data: threads = [], isLoading, isError, refetch } = useChatThreads();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
      </View>

      {isLoading && threads.length === 0 ? (
        <StateView variant="loading" label="Loading conversations" />
      ) : isError ? (
        <StateView variant="error" message="We could not load your messages." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {threads.length === 0 ? (
            <StateView variant="empty" icon={MessageSquare} title="No conversations yet" message="Patient messages will appear here." />
          ) : (
            threads.map((t) => <ThreadRow key={t.id} thread={t} />)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ThreadRow({ thread }: { thread: ChatThread }) {
  const time = new Date(thread.lastMessageAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  return (
    <Pressable
      style={[styles.card, shadow1]}
      onPress={() => router.push(`/(doctor)/consult/${thread.appointmentId}/chat`)}
      accessibilityRole="button"
      accessibilityLabel={`Chat with ${thread.patient.name}`}
    >
      <DoctorAvatar initials={thread.patient.initials} color={thread.patient.avatarColor} size={48} />
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={styles.name} numberOfLines={1}>{thread.patient.name}</Text>
          <Text style={styles.time}>{time}</Text>
        </View>
        <View style={styles.bottomLine}>
          <Text style={[styles.preview, thread.unreadCount > 0 && styles.previewUnread]} numberOfLines={1}>{thread.lastMessage}</Text>
          {thread.unreadCount > 0 ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{thread.unreadCount}</Text>
            </View>
          ) : (
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  header:        { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  title:         { ...Typography.headlineMd, color: Colors.onSurface },
  list:          { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Platform.OS === 'ios' ? 120 : 96, gap: Spacing.sm, flexGrow: 1 },
  card:          { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  body:          { flex: 1, gap: 4 },
  topLine:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name:          { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  time:          { ...Typography.caption, color: Colors.onSurfaceVariant },
  bottomLine:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  preview:       { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  previewUnread: { color: Colors.onSurface, fontWeight: '600' },
  unreadBadge:   { minWidth: 20, height: 20, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText:    { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' },
});
