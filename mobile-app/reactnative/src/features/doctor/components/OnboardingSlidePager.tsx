import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Maximize2 } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography, shadow2 } from '@/constants/tokens';
import { POSTER_ASPECT_RATIO, type OnboardingPoster } from '../constants/onboardingArtwork';
import CarouselDots from './CarouselDots';
import OnboardingPosterViewer from './OnboardingPosterViewer';

const NATIVE = Platform.OS !== 'web';
const FRAME_INSET = Spacing.md;

export interface PagerSlide {
  id:      string;
  title:   string;
  body:    string;
  icon:    LucideIcon;
  poster?: OnboardingPoster;
}

interface Props {
  slides:        PagerSlide[];
  onIndexChange?: (index: number) => void;
  activeIndex?:  number;
}

interface Size { width: number; height: number }

// Intro carousel. Each slide leads with its bundled clinic poster on a blurred
// stage of the same artwork, so the 9:16 print never crops and never sits in
// dead space. The live title/body stay underneath, and tapping the stage opens
// the poster full screen. Exposes the active index so the host screen can swap
// the skip/next/get-started CTA.
export default function OnboardingSlidePager({ slides, onIndexChange, activeIndex }: Props) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [stages, setStages] = useState<Record<string, Size>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const enter = useRef(new Animated.Value(1)).current;

  // Host-controlled paging (e.g. a "Next" button): scroll when activeIndex changes.
  useEffect(() => {
    if (activeIndex != null && activeIndex !== index && width > 0) {
      scrollRef.current?.scrollTo({ x: activeIndex * width, animated: true });
      setIndex(activeIndex);
    }
  }, [activeIndex, width]);

  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE,
    }).start();
  }, [index, enter]);

  // react-native-web drops onMomentumScrollEnd, so a swipe would move the
  // poster without moving the dots or the host's Next/Get started CTA. Read
  // the page from onScroll too, but only once it settles on a page boundary.
  const commitOffset = (offsetX: number) => {
    const page = offsetX / Math.max(1, width);
    const next = Math.round(page);
    if (Math.abs(page - next) > 0.02 || next < 0 || next >= slides.length) return;
    if (next !== index) {
      setIndex(next);
      onIndexChange?.(next);
    }
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => commitOffset(e.nativeEvent.contentOffset.x);

  const measureStage = (id: string) => (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setStages((prev) => (prev[id]?.width === w && prev[id]?.height === h ? prev : { ...prev, [id]: { width: w, height: h } }));
  };

  // Captions wrap to different heights, so every stage is measured and the
  // shortest one sets a single poster size — the artwork stays the same scale
  // across slides and never outgrows the stage it sits in.
  const frame = useMemo(() => {
    const sizes = Object.values(stages);
    if (sizes.length === 0) return null;
    const w = Math.min(...sizes.map((s) => s.width)) - FRAME_INSET * 2;
    const h = Math.min(...sizes.map((s) => s.height)) - FRAME_INSET * 2;
    if (w <= 0 || h <= 0) return null;
    const height = Math.min(h, w / POSTER_ASPECT_RATIO);
    return { width: height * POSTER_ASPECT_RATIO, height };
  }, [stages]);

  const posters = useMemo(() => {
    const seen = new Map<string, OnboardingPoster>();
    slides.forEach((s) => {
      if (s.poster && !failed[s.id] && !seen.has(s.poster.alt)) seen.set(s.poster.alt, s.poster);
    });
    return [...seen.values()];
  }, [slides, failed]);

  const rise = enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <View style={styles.wrap}>
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
        {slides.map((slide, i) => {
          const Icon = slide.icon;
          const poster = slide.poster;
          const broken = !poster || Boolean(failed[slide.id]);
          const active = i === index;
          return (
            <View key={slide.id} style={[styles.slide, { width }]}>
              <Pressable
                onLayout={measureStage(slide.id)}
                onPress={broken ? undefined : () => setViewerIndex(posters.indexOf(poster!))}
                disabled={broken}
                accessibilityRole="button"
                accessibilityLabel={broken ? slide.title : `Open poster ${i + 1} full screen`}
                style={({ pressed }) => [styles.stage, pressed && styles.stagePressed]}
              >
                {!broken && (
                  <>
                    <Image source={poster!.source} contentFit="cover" blurRadius={24} style={styles.backdrop} transition={200} />
                    <LinearGradient colors={['rgba(27,0,70,0.66)', 'rgba(11,0,24,0.88)']} style={StyleSheet.absoluteFill} />
                  </>
                )}

                {broken ? (
                  <View style={styles.iconBox}>
                    <Icon size={48} color={Colors.primary} strokeWidth={1.6} />
                  </View>
                ) : frame ? (
                  <Animated.View
                    style={[styles.frame, frame, shadow2, active && { opacity: enter, transform: [{ translateY: rise }] }]}
                  >
                    <Image
                      source={poster!.source}
                      alt={poster!.alt}
                      contentFit="cover"
                      style={styles.frameImage}
                      transition={280}
                      onError={() => setFailed((prev) => ({ ...prev, [slide.id]: true }))}
                    />
                  </Animated.View>
                ) : null}

                {!broken && (
                  <View style={styles.expandChip}>
                    <Maximize2 size={12} color={Colors.primaryFixed} strokeWidth={2.2} />
                    <Text style={styles.expandLabel}>Tap to expand</Text>
                  </View>
                )}
              </Pressable>

              <Animated.View style={[styles.caption, active && { opacity: enter, transform: [{ translateY: rise }] }]}>
                <Text style={styles.title}>{slide.title}</Text>
                <Text style={styles.body}>{slide.body}</Text>
              </Animated.View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.dots}>
        <CarouselDots count={slides.length} active={index} />
      </View>

      <OnboardingPosterViewer
        posters={posters}
        initialIndex={Math.max(0, viewerIndex ?? 0)}
        visible={viewerIndex != null}
        onClose={() => setViewerIndex(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:         { flex: 1 },
  flex:         { flex: 1 },
  slide:        { flex: 1, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.md },
  stage:        { flex: 1, borderRadius: Radius.xl, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryFixed, borderWidth: 1, borderColor: Colors.outlineVariant },
  stagePressed: { opacity: 0.92 },
  backdrop:     { ...StyleSheet.absoluteFillObject, transform: [{ scale: 1.15 }] },
  frame:        { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(234,179,8,0.45)', backgroundColor: Colors.white },
  frameImage:   { width: '100%', height: '100%' },
  iconBox:      { width: 112, height: 112, borderRadius: Radius.xxl, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  expandChip:   { position: 'absolute', right: Spacing.sm, bottom: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full, backgroundColor: 'rgba(11,0,24,0.55)' },
  expandLabel:  { ...Typography.caption, color: Colors.primaryFixed },
  caption:      { gap: Spacing.xs },
  title:        { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  body:         { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  dots:         { paddingVertical: Spacing.md },
});
