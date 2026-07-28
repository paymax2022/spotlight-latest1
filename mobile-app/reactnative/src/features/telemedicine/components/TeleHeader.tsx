import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  title:  string;
  right?: React.ReactNode;
  onBack?: () => void;
}

export default function TeleHeader({ title, right, onBack }: Props) {
  return (
    <View style={styles.bar}>
      <Pressable onPress={onBack ?? (() => router.back())} style={styles.iconBtn}>
        <ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={styles.right}>{right ?? <View style={styles.iconBtn} />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar:     { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(248,249,255,0.92)', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  title:   { ...Typography.titleLg, color: Colors.primary, flex: 1, textAlign: 'center', marginHorizontal: Spacing.sm },
  right:   { minWidth: 40, alignItems: 'flex-end' },
});
