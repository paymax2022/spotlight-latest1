import React from 'react';
import { ScrollView, Text, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';

export default function StoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Campaign story" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load story" actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>{c.title}</Text>
          {c.story.split('\n\n').map((para, i) => (
            <Text key={i} style={styles.para}>{para}</Text>
          ))}
          {c.tags.length > 0 && (
            <View style={styles.tagRow}>
              {c.tags.map((t) => <Text key={t} style={styles.tag}>#{t}</Text>)}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  para: { ...Typography.bodyLg, color: Colors.onSurface },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  tag: { ...Typography.labelSm, color: Colors.secondary, backgroundColor: Colors.iconBgBlue, borderRadius: 9999, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
});
