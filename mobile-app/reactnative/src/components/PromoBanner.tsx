import React from 'react';
import { Pressable, StyleSheet, Image } from 'react-native';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

interface Props {
  imageUri:   string;
  onPress:    () => void;
}

export default function PromoBanner({ imageUri, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrapper, pressed && { opacity: 0.9 }]}>
      <Image
        source={{ uri: imageUri }}
        style={styles.image}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.lg },
  image: {
    width: '100%',
    height: 180,
    borderRadius: Radius.xl,
  },
});
