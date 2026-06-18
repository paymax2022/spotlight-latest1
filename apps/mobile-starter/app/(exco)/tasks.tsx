// @ts-nocheck
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppLoader } from '@/components/ui/AppLoader';

export default function Exco_utasks() {
  const router = useRouter();
  useEffect(() => { router.replace('/tasks' as never); }, []);
  return <AppLoader />;
}
