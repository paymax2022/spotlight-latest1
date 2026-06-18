// @ts-nocheck
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppLoader } from '@/components/ui/AppLoader';

export default function GuardScan() {
  const router = useRouter();
  useEffect(() => { router.replace('/estate/guard/scan' as never); }, []);
  return <AppLoader />;
}
