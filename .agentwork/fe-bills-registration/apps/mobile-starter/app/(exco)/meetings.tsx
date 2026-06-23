// @ts-nocheck
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppLoader } from '@/components/ui/AppLoader';

export default function Exco_umeetings() {
  const router = useRouter();
  useEffect(() => { router.replace('/meetings' as never); }, []);
  return <AppLoader />;
}
