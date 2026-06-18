// @ts-nocheck
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppLoader } from '@/components/ui/AppLoader';

export default function Managerutenants() {
  const router = useRouter();
  useEffect(() => { router.replace('/landlord/tenants' as never); }, []);
  return <AppLoader />;
}
