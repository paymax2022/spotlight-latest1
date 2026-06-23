import React from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

interface Props {
  title:       string;
  subtitle?:   string;
  children:    React.ReactNode;
  showBack?:   boolean;
}

export default function AuthScreenWrapper({ title, subtitle, children, showBack }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Back button */}
          {showBack && (
            <Pressable onPress={() => router.back()} style={styles.back}>
              <ArrowLeft size={22} color={Colors.onSurface} />
            </Pressable>
          )}

          {/* Logo mark */}
          <View style={styles.logoMark}>
            <View style={styles.logoInner} />
          </View>

          {/* Heading */}
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

          <View style={styles.content}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow:        1,
    paddingHorizontal: Spacing.containerMargin,
    paddingBottom:   Spacing.xxl,
  },
  back: {
    width:           40,
    height:          40,
    borderRadius:    20,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: Colors.surfaceContainerLow,
    marginTop:       Spacing.md,
    marginBottom:    Spacing.lg,
  },
  logoMark: {
    width:           56,
    height:          56,
    borderRadius:    16,
    backgroundColor: Colors.primary,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    Spacing.lg,
  },
  logoInner: {
    width:           28,
    height:          28,
    borderRadius:    8,
    backgroundColor: Colors.onPrimaryContainer,
    opacity:         0.7,
  },
  title: {
    ...Typography.headlineLgMobile,
    color:           Colors.onSurface,
    marginBottom:    Spacing.xs,
  },
  subtitle: {
    ...Typography.bodyMd,
    color:           Colors.onSurfaceVariant,
    marginBottom:    Spacing.xl,
  },
  content: {
    flex: 1,
  },
});
