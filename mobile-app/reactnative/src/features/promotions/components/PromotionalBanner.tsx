import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { ChevronRight, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { PromotionalBanner } from '../types';

interface PromotionalBannerProps {
  banner: PromotionalBanner;
  onClose?: () => void;
  style?: any;
}

export function PromotionalBannerCard({ banner, onClose, style }: PromotionalBannerProps) {
  const [isLoading, setIsLoading] = useState(true);

  const handlePress = () => {
    if (banner.action_link) {
      // Deep link into the app
      router.push(banner.action_link as never);
    }
  };

  return (
    <Pressable
      style={[styles.container, style]}
      onPress={handlePress}
      disabled={!banner.action_link}
      accessibilityRole="button"
      accessibilityLabel={banner.title}
    >
      {/* Background image */}
      <Image
        source={{ uri: banner.image_url }}
        style={styles.backgroundImage}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
        resizeMode="cover"
      />

      {/* Overlay for text readability */}
      <View style={styles.overlay} />

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.textContainer}>
          <Text style={styles.title} numberOfLines={2}>
            {banner.title}
          </Text>
          {banner.description && (
            <Text style={styles.description} numberOfLines={2}>
              {banner.description}
            </Text>
          )}
        </View>

        {/* Action button or close button */}
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Dismiss banner">
            <X size={20} color={Colors.onPrimary} strokeWidth={2.5} />
          </Pressable>
        ) : banner.action_link ? (
          <View style={styles.actionContainer}>
            <Text style={styles.actionLabel}>
              {banner.action_label || 'View'}
            </Text>
            <ChevronRight size={16} color={Colors.onPrimary} strokeWidth={2.5} />
          </View>
        ) : null}
      </View>

      {/* Loading indicator */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    minHeight: 140,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.sm,
  },
  backgroundImage: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  content: {
    flex: 1,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textContainer: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.onPrimary,
  },
  description: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  actionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.onPrimary,
  },
  loadingContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
