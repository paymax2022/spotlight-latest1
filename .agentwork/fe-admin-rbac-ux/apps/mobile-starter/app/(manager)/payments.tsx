// @ts-nocheck
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppLoader } from '@/components/ui/AppLoader';

export default function Managerupayments() {
  const router = useRouter();
  useEffect(() => { router.replace('/estate/dues' as never); }, []);
  return <AppLoader />;
}
