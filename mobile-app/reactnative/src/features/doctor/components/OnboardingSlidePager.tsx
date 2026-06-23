import React, { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import CarouselDots from './CarouselDots';

export interface PagerSlide {
  id:    string;
  title: string;
  body:  string;
  icon:  LucideIcon;
}

interface Props {
  slides:        PagerSlide[];
  onIndexChange?: (index: number) => void;
  activeIndex?:  number;   // host-controlled page (e.g. a "Next" button); scrolls when changed
}

// New component (Section A · entry 2): a horizontally-paged intro carousel over
// OnboardingSlide[]. No existing component does paged horizontal slides; reuses
// CarouselDots for the position indicator. Exposes the active index via
// onIndexChange so the host screen can swap the skip/next/get-started CTA.
export default function OnboardingSlidePager({ slides, onIndexChange, activeIndex }: Props) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  // Host-controlled paging (e.g. a "Next" button): scroll when activeIndex changes.
  useEffect(() => {
    if (activeIndex != null && activeIndex !== index && width > 0) {
      scrollRef.current?.scrollTo({ x: activeIndex * width, animated: true });
      setIndex(activeIndex);
    }
  }, [activeIndex, width]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (next !== index) {
      setIndex(next);
      onIndexChange?.(next);
    }
  };

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
      >
        {slides.map((slide) => {
          const Icon = slide.icon;
          return (
            <View key={slide.id} style={[styles.slide, { width }]}>
              <View style={styles.iconBox}>
                <Icon size={48} color={Colors.primary} strokeWidth={1.6} />
              </View>
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.body}>{slide.body}</Text>
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.dots}>
        <CarouselDots count={slides.length} active={index} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:    { flex: 1 },
  slide:   { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 112, height: 112, borderRadius: Radius.xxl, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  title:   { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  body:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  dots:    { paddingVertical: Spacing.lg },
});
