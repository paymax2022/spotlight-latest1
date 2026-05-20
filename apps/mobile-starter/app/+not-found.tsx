// @ts-nocheck
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/AppButton';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <AppScreen contentStyle={{ justifyContent: 'center', flexGrow: 1 }}>
      <AppText variant="h1">Not Found</AppText>
      <AppText>This page does not exist.</AppText>
      <AppButton title="Go Home" onPress={() => router.replace('/')} />
    </AppScreen>
  );
}
