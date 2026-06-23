// @ts-nocheck
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppLoader } from '@/components/ui/AppLoader';

export default function Managerurepairs() {
  const router = useRouter();
  useEffect(() => { router.replace('/repairs' as never); }, []);
  return <AppLoader />;
}
