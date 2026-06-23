import React from 'react';
import { FlatList, View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Heart, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { relativeTime } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function UpdatesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Campaign updates"
        rightSlot={
          <Pressable onPress={() => router.push(`/crowdfunding/campaign/${id}/post-update`)} hitSlop={8} accessibilityLabel="Post an update">
            <Plus size={22} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
        }
      />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load updates" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={c.updates}
          keyExtractor={(u) => u.id}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <View style={styles.card}>
              <View style={styles.timelineCol}>
                <View style={[styles.dot, index === 0 && styles.dotActive]} />
                {index < c.updates.length - 1 && <View style={styles.line} />}
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
                <Text style={styles.title}>{item.title}</Text>
                {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.image} resizeMode="cover" /> : null}
                <Text style={styles.text}>{item.body}</Text>
                <View style={styles.likeRow}>
                  <Heart size={14} color={Colors.error} fill={Colors.error} strokeWidth={2} />
                  <Text style={styles.likeText}>{item.likeCount} found this encouraging</Text>
                </View>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <StateView kind="empty" icon="Megaphone" title="No updates yet" message="The creator hasn't posted any updates. Check back soon." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, flexGrow: 1 },
  card: { flexDirection: 'row', gap: Spacing.md },
  timelineCol: { alignItems: 'center', width: 16, paddingTop: 6 },
  dot: { width: 12, height: 12, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHighest, borderWidth: 2, borderColor: Colors.outlineVariant },
  dotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  line: { flex: 1, width: 2, backgroundColor: Colors.surfaceContainerHigh, marginTop: 4 },
  cardBody: { flex: 1, paddingBottom: Spacing.lg, gap: 6 },
  time: { ...Typography.caption, color: Colors.onSurfaceVariant },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  image: { width: '100%', height: 180, borderRadius: Radius.lg, marginVertical: 4 },
  text: { ...Typography.bodyMd, color: Colors.onSurface },
  likeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  likeText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
