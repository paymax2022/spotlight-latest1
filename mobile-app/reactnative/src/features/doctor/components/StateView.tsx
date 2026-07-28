import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import PrimaryButton from '@/components/PrimaryButton';

interface LoadingProps { variant: 'loading'; label?: string }
interface ErrorProps   { variant: 'error'; title?: string; message?: string; onRetry?: () => void }
interface EmptyProps   { variant: 'empty'; icon?: LucideIcon; title: string; message?: string }
type Props = LoadingProps | ErrorProps | EmptyProps;

// New component: a shared loading / error(retry) / empty placeholder used across
// every doctor screen to render the API-contract states consistently. No single
// existing component covers all three states, so this is genuinely new.
export default function StateView(props: Props) {
  if (props.variant === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        {!!props.label && <Text style={styles.message}>{props.label}</Text>}
      </View>
    );
  }

  if (props.variant === 'error') {
    return (
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <AlertCircle size={40} color={Colors.error} strokeWidth={1.6} />
        </View>
        <Text style={styles.title}>{props.title ?? 'Something went wrong'}</Text>
        <Text style={styles.message}>{props.message ?? 'Please check your connection and try again.'}</Text>
        {props.onRetry && (
          <View style={styles.btnWrap}>
            <PrimaryButton label="Try again" onPress={props.onRetry} variant="secondary" fullWidth={false} />
          </View>
        )}
      </View>
    );
  }

  const Icon = props.icon;
  return (
    <View style={styles.center}>
      {Icon && (
        <View style={styles.iconWrap}>
          <Icon size={40} color={Colors.outline} strokeWidth={1.6} />
        </View>
      )}
      <Text style={styles.title}>{props.title}</Text>
      {!!props.message && <Text style={styles.message}>{props.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  center:   { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xxl, gap: Spacing.sm },
  iconWrap: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  title:    { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  message:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  btnWrap:  { marginTop: Spacing.md },
});
