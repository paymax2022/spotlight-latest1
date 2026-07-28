// @ts-nocheck
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppLoader } from '@/components/ui/AppLoader';

export default function Exco_uelections() {
  const router = useRouter();
  useEffect(() => { router.replace('/estate/elections' as never); }, []);
  return <AppLoader />;
}
