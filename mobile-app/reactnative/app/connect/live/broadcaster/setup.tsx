import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useStartBroadcast } from '@/features/connect/live/hooks';

const CATEGORIES = ['music', 'talk', 'gaming', 'lifestyle', 'dance', 'events'];

/** Go-live setup (PRD §10.7 LB-01): title, category, tags, cover, location toggle. */
export default function BroadcastSetupScreen() {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('music');
  const [tags, setTags] = useState('');
  const [shareLocation, setShareLocation] = useState(false);
  const start = useStartBroadcast();

  function goLive() {
    if (!title.trim()) return;
    start.mutate(
      { title: title.trim(), category, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), shareLocation },
      { onSuccess: () => router.replace('/connect/live/broadcaster/live-console') },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Stream setup" subtitle="Before you go live" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.coverPlaceholder}>
          <Text style={styles.coverText}>Tap to add a cover image</Text>
        </View>

        <TextInputField label="Stream title" value={title} onChangeText={setTitle} placeholder="What's your stream about?" />

        <Text style={styles.label}>Category</Text>
        <View style={styles.chips}>
          {CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <Pressable key={c} style={[styles.chip, active && styles.chipActive]} onPress={() => setCategory(c)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c[0].toUpperCase() + c.slice(1)}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextInputField label="Tags (comma-separated)" value={tags} onChangeText={setTags} placeholder="afrobeats, live, lagos" />

        <Pressable style={styles.locRow} onPress={() => setShareLocation((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: shareLocation }}>
          <View style={styles.locLeft}>
            <MapPin size={18} color={ConnectColors.brand} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.locTitle}>Show approximate location</Text>
              <Text style={styles.locSub}>Only a city-level label is shown — never your exact location.</Text>
            </View>
          </View>
          <View style={[styles.toggle, shareLocation && styles.toggleOn]}>
            <View style={[styles.knob, shareLocation && styles.knobOn]} />
          </View>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={start.isPending ? 'Starting…' : 'Go live'} onPress={goLive} disabled={!title.trim() || start.isPending} loading={start.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  coverPlaceholder: { width: '100%', aspectRatio: 16 / 9, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: ConnectColors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  coverText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1.5, borderColor: ConnectColors.border, backgroundColor: Colors.surfaceContainerLowest },
  chipActive: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: ConnectColors.brand, fontWeight: '700' as const },
  locRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md },
  locLeft: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', flex: 1 },
  locTitle: { ...Typography.labelLg, color: Colors.onSurface },
  locSub: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  toggle: { width: 46, height: 28, borderRadius: 14, backgroundColor: Colors.surfaceContainerHigh, padding: 3, justifyContent: 'center' },
  toggleOn: { backgroundColor: ConnectColors.brand },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.onPrimary },
  knobOn: { alignSelf: 'flex-end' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: ConnectColors.border },
});
