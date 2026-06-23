// @ts-nocheck
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/AppButton';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';

export default function PayScreen() {
  const router = useRouter();
  return (
    <AppScreen>
      <AppText variant="h1">Pay Bills</AppText>
      <AppButton title="Airtime" onPress={() => router.push('/airtime')} />
      <AppButton title="Data" onPress={() => router.push('/data')} />
      <AppButton title="Electricity" onPress={() => router.push('/electricity')} />
      <AppButton title="Cable TV" onPress={() => router.push('/cable')} />
    </AppScreen>
  );
}
