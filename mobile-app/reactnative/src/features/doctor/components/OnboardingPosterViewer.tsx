import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import type { OnboardingPoster } from '../constants/onboardingArtwork';
import CarouselDots from './CarouselDots';

interface Props {
  posters:      OnboardingPoster[];
  initialIndex: number;
  visible:      boolean;
  onClose:      () => void;
}

// Full-screen reader for the intro posters. The carousel frame is only as tall
// as the slide allows, which makes the posters' own feature lists hard to read;
// this gives them the whole viewport, uncropped.
export default function OnboardingPosterViewer({ posters, initialIndex, visible, onClose }: Props) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    setIndex(initialIndex);
    scrollRef.current?.scrollTo({ x: initialIndex * width, animated: false });
  }, [visible, initialIndex, width]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(next, posters.length - 1));
    setIndex(clamped);
    scrollRef.current?.scrollTo({ x: clamped * width, animated: true });
  };

  // onMomentumScrollEnd never fires on react-native-web — see the pager.
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = e.nativeEvent.contentOffset.x / Math.max(1, width);
    const next = Math.round(page);
    if (Math.abs(page - next) > 0.02 || next < 0 || next >= posters.length) return;
    if (next !== index) setIndex(next);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <LinearGradient colors={['#1B0046', '#0B0018']} style={StyleSheet.absoluteFill} />
        <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
          <View style={styles.bar}>
            <Text style={styles.counter}>{index + 1} / {posters.length}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close poster"
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
            >
              <X size={22} color={Colors.white} strokeWidth={2.2} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleScroll}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            style={styles.flex}
          >
            {posters.map((poster, i) => (
              <View key={i} style={[styles.page, { width }]}>
                <Image source={poster.source} alt={poster.alt} contentFit="contain" style={styles.image} transition={200} />
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={() => go(index - 1)}
              disabled={index === 0}
              accessibilityRole="button"
              accessibilityLabel="Previous poster"
              style={({ pressed }) => [styles.navBtn, index === 0 && styles.navBtnDisabled, pressed && styles.pressed]}
            >
              <ChevronLeft size={22} color={Colors.white} strokeWidth={2.2} />
            </Pressable>
            <CarouselDots count={posters.length} active={index} tone="onDark" />
            <Pressable
              onPress={() => go(index + 1)}
              disabled={index === posters.length - 1}
              accessibilityRole="button"
              accessibilityLabel="Next poster"
              style={({ pressed }) => [styles.navBtn, index === posters.length - 1 && styles.navBtnDisabled, pressed && styles.pressed]}
            >
              <ChevronRight size={22} color={Colors.white} strokeWidth={2.2} />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root:           { flex: 1, backgroundColor: Colors.backdropDark },
  flex:           { flex: 1 },
  bar:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  counter:        { ...Typography.labelMd, color: Colors.primaryFixedDim },
  closeBtn:       { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  page:           { flex: 1, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  image:          { width: '100%', height: '100%' },
  footer:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  navBtn:         { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  navBtnDisabled: { opacity: 0.3 },
  pressed:        { opacity: 0.7 },
});
