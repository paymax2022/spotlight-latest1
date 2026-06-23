// @ts-nocheck
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppLoader } from '@/components/ui/AppLoader';

export default function GuardVisitors() {
  const router = useRouter();
  useEffect(() => { router.replace('/estate/guard/expected' as never); }, []);
  return <AppLoader />;
}
