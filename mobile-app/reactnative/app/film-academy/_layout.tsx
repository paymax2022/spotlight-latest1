import { Stack } from 'expo-router';
import { View } from 'react-native';
import ModuleTabBar from '@/components/ModuleTabBar';
import { FILM_ACADEMY_TABS } from '@/constants/moduleTabs';

export default function FilmAcademyLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <ModuleTabBar tabs={FILM_ACADEMY_TABS} />
    </View>
  );
}
