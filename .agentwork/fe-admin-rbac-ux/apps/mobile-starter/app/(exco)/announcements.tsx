// @ts-nocheck
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppLoader } from '@/components/ui/AppLoader';

export default function Exco_uannouncements() {
  const router = useRouter();
  useEffect(() => { router.replace('/announcements' as never); }, []);
  return <AppLoader />;
}
