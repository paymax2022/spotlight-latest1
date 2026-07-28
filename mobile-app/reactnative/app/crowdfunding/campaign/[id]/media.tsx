import React, { useState } from 'react';
import { View, Image, Pressable, StyleSheet, useWindowDimensions, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Play } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';

export default function MediaGalleryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);
  const { width } = useWindowDimensions();
  const [active, setActive] = useState(0);
  const size = width - Spacing.containerMargin * 2;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Media gallery" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load media" actionLabel="Retry" onAction={refetch} />
      ) : c.media.length === 0 ? (
        <StateView kind="empty" icon="ImageOff" title="No media" message="This campaign has no photos or video yet." />
      ) : (
        <View style={styles.body}>
          <Image source={{ uri: c.media[active].url }} style={[styles.hero, { width: size, height: size * 0.7 }]} resizeMode="cover" />
          {c.media[active].type === 'video' && (
            <View style={styles.playOverlay}><Play size={28} color={Colors.white} fill={Colors.white} /></View>
          )}
          <FlatList
            data={c.media}
            horizontal
            keyExtractor={(m) => m.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbRow}
            renderItem={({ item, index }) => (
              <Pressable onPress={() => setActive(index)} accessibilityRole="button" accessibilityLabel={`Photo ${index + 1}`}>
                <Image source={{ uri: item.thumbnailUrl ?? item.url }} style={[styles.thumb, active === index && styles.thumbActive]} resizeMode="cover" />
              </Pressable>
            )}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, alignItems: 'center', gap: Spacing.md },
  hero: { borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerHigh },
  playOverlay: { position: 'absolute', top: '28%', alignSelf: 'center', width: 60, height: 60, borderRadius: Radius.full, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  thumbRow: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  thumb: { width: 64, height: 64, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, borderWidth: 2, borderColor: Colors.transparent },
  thumbActive: { borderColor: Colors.primary },
});
