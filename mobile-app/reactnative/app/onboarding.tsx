import React, { useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Dimensions, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

const SLIDES = [
  { id: '1', emoji: '💰', title: 'One App, All Your Money', body: 'Send, receive, save and invest — all in one powerful wallet designed for your lifestyle.', colors: ['#340075','#4C1D95'] as [string,string] },
  { id: '2', emoji: '⚡', title: 'Pay Everything Instantly', body: 'Bills, airtime, data, subscriptions. Pay in seconds with zero stress and maximum security.', colors: ['#0051D5','#316BF3'] as [string,string] },
  { id: '3', emoji: '🌟', title: 'Live Better, Every Day', body: 'Food, rides, hotels, events, health — your full lifestyle ecosystem in one premium app.', colors: ['#002D28','#00453F'] as [string,string] },
];

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<FlatList>(null);

  function next() {
    if (activeIdx < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: activeIdx + 1, animated: true });
    } else {
      router.replace('/(auth)/login');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.skip}>
        <Pressable onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setActiveIdx(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <LinearGradient colors={item.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
              <Text style={styles.emoji}>{item.emoji}</Text>
            </LinearGradient>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      {/* Dots */}
      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === activeIdx && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.cta}>
        <PrimaryButton
          label={activeIdx === SLIDES.length - 1 ? 'Get Started' : 'Continue'}
          onPress={next}
        />
        {activeIdx === SLIDES.length - 1 && (
          <Pressable onPress={() => router.replace('/(auth)/login')} style={styles.signIn}>
            <Text style={styles.signInText}>Already have an account? <Text style={styles.signInLink}>Sign In</Text></Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  skip: { alignItems: 'flex-end', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  skipText: { ...Typography.labelMd, color: Colors.secondary },
  slide: { paddingHorizontal: Spacing.containerMargin, alignItems: 'center' },
  hero: {
    width:          '100%',
    height:         280,
    borderRadius:   Radius.xl,
    alignItems:     'center',
    justifyContent: 'center',
    marginBottom:   Spacing.xl,
    marginTop:      Spacing.lg,
  },
  emoji:  { fontSize: 80 },
  title:  { ...Typography.headlineLgMobile, color: Colors.onSurface, textAlign: 'center', marginBottom: Spacing.md },
  body:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 26 },
  dots:   { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xs, marginVertical: Spacing.lg },
  dot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.outlineVariant },
  dotActive: { width: 24, backgroundColor: Colors.primary },
  cta:    { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.md },
  signIn: { alignItems: 'center' },
  signInText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  signInLink: { color: Colors.secondary, fontWeight: '600' },
});
