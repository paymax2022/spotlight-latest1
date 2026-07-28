// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { AppButton } from '@/components/ui/AppButton';
import { AppText } from '@/components/ui/AppText';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const slides = [
  {
    icon: 'shield-checkmark' as const,
    iconColor: '#14b8a6',
    title: 'Secure Your Estate',
    body: 'Advanced security features keep your estate protected 24/7. Manage visitor access, gate logs, and incident reports from your phone.',
  },
  {
    icon: 'people' as const,
    iconColor: colors.secondary.DEFAULT,
    title: 'Manage Your Community',
    body: 'Stay connected with your neighbours and estate management. Vote on decisions, join community groups, and participate in estate governance.',
  },
  {
    icon: 'wallet' as const,
    iconColor: colors.gold.DEFAULT,
    title: 'Pay Dues & Rent',
    body: 'Pay service charges, rent, and levies instantly. Track payment history, receive receipts, and never miss a due date again.',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [currentSlide, setCurrentSlide] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const goToSlide = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    setCurrentSlide(index);
  };

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      goToSlide(currentSlide + 1);
    } else {
      router.push('/(auth)/user-type' as never);
    }
  };

  const handleSkip = () => {
    router.push('/(auth)/user-type' as never);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.skipRow}>
        <Pressable onPress={handleSkip} style={styles.skipBtn}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
          setCurrentSlide(idx);
        }}
        style={styles.slider}
      >
        {slides.map((slide, index) => (
          <View key={index} style={styles.slide}>
            <View style={styles.iconContainer}>
              <Ionicons name={slide.icon} size={72} color={slide.iconColor} />
            </View>
            <AppText variant="h1" style={styles.slideTitle}>{slide.title}</AppText>
            <AppText variant="body" style={styles.slideBody}>{slide.body}</AppText>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {slides.map((_, i) => (
          <Pressable key={i} onPress={() => goToSlide(i)}>
            <View style={[styles.dot, i === currentSlide && styles.dotActive]} />
          </Pressable>
        ))}
      </View>

      <View style={styles.footer}>
        <AppButton
          title={currentSlide === slides.length - 1 ? 'Get Started' : 'Next'}
          variant="primary"
          onPress={handleNext}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  skipRow: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  skipBtn: { padding: 8 },
  skipText: { color: colors.neutral.textMuted, fontSize: 14 },
  slider: { flex: 1 },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 24,
  },
  iconContainer: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.neutral.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  slideTitle: { textAlign: 'center' },
  slideBody: { textAlign: 'center', color: colors.neutral.textMuted, lineHeight: 24 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.neutral.border,
  },
  dotActive: {
    backgroundColor: colors.primary.DEFAULT,
    width: 24,
  },
  footer: { paddingHorizontal: 20, paddingBottom: 24 },
});
